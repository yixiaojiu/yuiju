import { setTimeout } from "node:timers/promises";
import { logger } from "@yuiju/shared/logger/logger";
import type {
  ExecuteActionInput,
  ExecuteActionResult,
  InspectWorldInput,
  InspectWorldResult,
  WorldResult,
} from "@yuiju/shared/world/protocol";
import { actionsById } from "./actions/definitions";
import { createActionContext, settleActivity, startAction } from "./actions/execution";
import { createCharacterState, type WorldCharacterDefinition } from "./content/characters";
import type { WorldAdvanceContext, WorldEvolution } from "./environment/evolution";
import { isPlaceOpen, PlaceEvolution } from "./environment/places";
import { ResourceEvolution, refreshResources } from "./environment/resources";
import { worldTime } from "./environment/time";
import { generateWeather, WeatherEvolution, weatherPeriod } from "./environment/weather";
import { createWorldFact, type WorldFact } from "./events";
import { actionConditions, actionIsKnown, inspectWorld, parseActionPayload } from "./inspect";
import type { WorldMap } from "./map";
import type { WorldEventQueues } from "./queue";
import { generateRandomEvent } from "./random-event";
import type { WorldState } from "./state";
import {
  commitWorldState,
  loadWorldState,
  type RequestReceipt,
  readRequestReceipt,
} from "./storage";

/** 状态检查与提交串行执行；活动持续时间和模型生成不占用修改队列。 */
export class World {
  readonly map: WorldMap;
  readonly characterDefinitions: ReadonlyMap<string, WorldCharacterDefinition>;
  readonly characterNames: ReadonlyMap<string, string>;
  readonly timezone: string;
  private readonly queues: WorldEventQueues;
  /** 最近一次成功提交的完整快照；null 表示尚未加载或提交结果不确定。 */
  private committedState: WorldState | null = null;
  /** 行动请求、时间推进和异步结算共用此队列；不排入模型请求或 Mongo 归档。 */
  private readonly pendingStateChanges: (() => Promise<void>)[] = [];
  private processingStateChanges = false;
  private readonly stopController = new AbortController();
  private worldLoopTask: Promise<void> | undefined;
  /** 世界自身的变化按声明顺序推进，与角色活动的结算规则分开。 */
  private readonly evolutions: readonly WorldEvolution[] = [
    new WeatherEvolution(),
    new ResourceEvolution(),
    new PlaceEvolution(),
  ];
  /** 按活动 ID 跟踪生成与结算任务，防止重复 tick 再次生成；仅在当前进程持有。 */
  private readonly activityCompletionTasks = new Map<string, Promise<void>>();

  constructor(
    map: WorldMap,
    characterDefinitions: ReadonlyMap<string, WorldCharacterDefinition>,
    characterNames: ReadonlyMap<string, string>,
    timezone: string,
    queues: WorldEventQueues,
  ) {
    this.map = map;
    this.characterDefinitions = characterDefinitions;
    this.characterNames = characterNames;
    this.timezone = timezone;
    this.queues = queues;
  }

  /** 恢复状态，补算到期活动，加入新角色后启动循环。 */
  async start(): Promise<void> {
    const savedState = await loadWorldState();
    const now = Date.now();
    if (savedState === null) {
      const period = weatherPeriod(now, this.timezone);
      const initialState: WorldState = {
        weather: generateWeather(period, null, this.timezone),
        weatherPeriod: period,
        resourceDate: worldTime(now, this.timezone).format("YYYY-MM-DD"),
        places: Object.fromEntries(
          [...this.map.placesById.keys()].map((id) => [
            id,
            { resources: {}, closed: false, isOpen: isPlaceOpen(id, now, this.timezone, false) },
          ]),
        ),
        characters: Object.fromEntries(
          [...this.characterDefinitions.values()].map((definition) => [
            definition.characterId,
            createCharacterState(definition, now),
          ]),
        ),
      };
      refreshResources(initialState, initialState.resourceDate);
      await commitWorldState(this.queues, null, initialState, []);
      this.committedState = initialState;
    } else {
      this.committedState = savedState;
      for (const characterId of Object.keys(savedState.characters)) {
        if (!this.characterDefinitions.has(characterId)) {
          throw new Error(`已保存的世界角色 ${characterId} 缺少当前角色资料，不能继续结算`);
        }
      }
    }
    // 恢复先完成旧活动与环境推进，之后才允许入口接收新的请求。
    await this.enqueueStateChange(async () => this.advanceWorldTo(now));
    // 在队列外等待补算，小插曲与普通完成结果走相同的提交入口。
    await Promise.all(this.activityCompletionTasks.values());
    // 旧活动恢复完成后再加入配置中的新角色，不覆盖已有角色状态。
    const draftState = structuredClone(this.committedState!);
    for (const definition of this.characterDefinitions.values()) {
      if (!draftState.characters[definition.characterId]) {
        draftState.characters[definition.characterId] = createCharacterState(definition, now);
      }
    }
    await this.commitStateAndFacts(draftState, []);
    this.worldLoopTask = this.runWorldLoop();
  }

  async stop(): Promise<void> {
    this.stopController.abort();
    await this.worldLoopTask;
    await Promise.all(this.activityCompletionTasks.values());
    // 队尾屏障：等待停止前已经接收的状态修改完成。
    await this.enqueueStateChange(async () => {});
  }

  inspect(characterId: string, input: InspectWorldInput): WorldResult<InspectWorldResult> {
    if (this.committedState === null) {
      return { ok: false, code: "world_unavailable", message: "世界状态尚未恢复，暂时无法查询" };
    }
    const definition = this.characterDefinitions.get(characterId);
    if (!definition || !this.committedState.characters[characterId]) {
      return { ok: false, code: "character_not_found", message: "角色尚未加入这个世界" };
    }
    return inspectWorld(
      input,
      createActionContext(
        this.committedState,
        definition,
        this.map,
        Date.now(),
        this.timezone,
        "inspect",
      ),
      definition,
      this.characterNames,
    );
  }

  async execute(
    characterId: string,
    requestId: string,
    input: ExecuteActionInput,
  ): Promise<WorldResult<ExecuteActionResult>> {
    return this.enqueueStateChange(async () => {
      await this.restoreAfterFailedCommit();
      const definition = this.characterDefinitions.get(characterId);
      if (!definition || !this.committedState!.characters[characterId]) {
        return { ok: false, code: "character_not_found", message: "角色尚未加入这个世界" };
      }

      // 已成功执行的请求直接返回原结果，不能再次扣款或创建活动。
      const previousRequest = await readRequestReceipt(characterId, requestId);
      if (previousRequest) {
        if (
          previousRequest.actionId !== input.actionId ||
          previousRequest.payload !== input.payload
        ) {
          return {
            ok: false,
            code: "request_conflict",
            message: "同一请求标识不能用于不同的行动内容",
          };
        }
        return { ok: true, value: previousRequest.result };
      }

      // 先处理到当前时刻的变化，再按最新状态检查新行动。
      const now = Date.now();
      await this.advanceWorldTo(now);
      const action = actionsById.get(input.actionId);
      if (!action || !actionIsKnown(action, definition)) {
        return { ok: false, code: "action_not_available", message: "角色没有这个行动" };
      }
      const parsedPayload = parseActionPayload(action, input.payload);
      if (!parsedPayload.ok) {
        return parsedPayload;
      }

      const draftState = structuredClone(this.committedState!);
      const draftContext = createActionContext(
        draftState,
        definition,
        this.map,
        now,
        this.timezone,
        "execute",
      );
      const conditions = actionConditions(action, draftContext, parsedPayload.value);
      if (conditions.some((condition) => condition.status !== "met")) {
        return {
          ok: false,
          code: "conditions_not_met",
          message: "当前无法执行这个行动",
          conditions,
        };
      }

      // 以下计算只修改 draftState；Redis 提交前不向查询发布。
      const { result, facts } = startAction(
        draftContext,
        action,
        parsedPayload.value,
        this.characterNames,
      );
      // 即时行动也走同一结算函数，开始与完成事实和状态一起提交。
      if (result.status === "completed") {
        facts.push(
          settleActivity(draftState, definition, this.map, this.characterNames, this.timezone),
        );
      }
      await this.commitStateAndFacts(draftState, facts, {
        characterId,
        requestId,
        actionId: input.actionId,
        payload: input.payload,
        result,
        executedAt: now,
      });
      return { ok: true, value: result };
    });
  }

  /** 持续驱动世界推进；一轮结束后等待 1 秒，不叠加 tick。 */
  private async runWorldLoop(): Promise<void> {
    const signal = this.stopController.signal;
    while (!signal.aborted) {
      try {
        // 每轮按时间顺序推进环境 Evolution 与到期活动，共用一次状态修改队列。
        await this.enqueueStateChange(async () => this.advanceWorldTo(Date.now()));
      } catch (error) {
        logger.error("世界推进失败，下一轮从已提交状态恢复", { error });
      }
      try {
        await setTimeout(1_000, undefined, { signal });
      } catch (error) {
        if (!signal.aborted) {
          throw error;
        }
      }
    }
  }

  /** 先推进环境到每项到期活动的结束时间并结算，再推进到当前时间；模型生成不占用队列。 */
  private async advanceWorldTo(targetTime: number): Promise<void> {
    await this.restoreAfterFailedCommit();
    while (!this.stopController.signal.aborted) {
      const committedState = this.committedState!;
      const charactersWithActivities = Object.values(committedState.characters)
        .filter(
          (character) =>
            character.currentActivity !== null &&
            !this.activityCompletionTasks.has(character.currentActivity.activityId),
        )
        .sort((a, b) =>
          a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0,
        );
      const stepTime = Math.min(
        targetTime,
        ...charactersWithActivities.map((character) => character.currentActivity!.endsAt),
      );
      const draftState = structuredClone(committedState);

      // 环境独立演化；每项规则自行判断是否需要更新，并描述实际发生的变化。
      const environmentContext: WorldAdvanceContext = {
        state: draftState,
        now: stepTime,
        timezone: this.timezone,
        events: [],
      };
      let environmentChanged = false;
      for (const evolution of this.evolutions) {
        if (!evolution.precondition(environmentContext)) {
          continue;
        }
        evolution.advance(environmentContext);
        environmentChanged = true;
      }
      const facts = environmentContext.events.map((event) =>
        createWorldFact(event, draftState, this.map, this.characterNames, this.timezone),
      );

      // 再结算此刻到期的角色活动，避免昨天结束的普通活动使用今天刷新后的物资。
      const pendingRandomEventGenerations: { characterId: string; positive: boolean }[] = [];
      for (const character of charactersWithActivities) {
        if (character.currentActivity!.endsAt !== stepTime) {
          continue;
        }
        const randomEvent = actionsById.get(character.currentActivity!.actionId)!.randomEvent;
        if (randomEvent && Math.random() < randomEvent.probability) {
          pendingRandomEventGenerations.push({
            characterId: character.characterId,
            positive: Math.random() < randomEvent.positiveProbability,
          });
        } else {
          facts.push(
            settleActivity(
              draftState,
              this.characterDefinitions.get(character.characterId)!,
              this.map,
              this.characterNames,
              this.timezone,
            ),
          );
        }
      }
      if (environmentChanged || facts.length) {
        await this.commitStateAndFacts(draftState, facts);
      }

      // 环境提交后再取得生成上下文。只启动任务，不能在修改队列内 await 模型。
      if (this.stopController.signal.aborted) {
        return;
      }
      for (const { characterId, positive } of pendingRandomEventGenerations) {
        const activityId = this.committedState!.characters[characterId].currentActivity!.activityId;
        const completionTask = this.generateRandomEventAndSettleActivity(characterId, positive);
        this.activityCompletionTasks.set(activityId, completionTask);
      }
      if (stepTime === targetTime) {
        return;
      }
    }
  }

  /** 生成不占用修改队列；保存失败保留已生成文本，重新进入队列按最新状态结算。 */
  private async generateRandomEventAndSettleActivity(
    characterId: string,
    positive: boolean,
  ): Promise<void> {
    const character = this.committedState!.characters[characterId];
    const activity = character.currentActivity!;
    // 固定活动发生时的上下文；不携带待提交的状态副本或提前计算的结算结果。
    const input = {
      name: this.characterNames.get(characterId)!,
      occurredAt: activity.endsAt,
      timezone: this.timezone,
      place: this.map.placesById.get(character.placeId!)!.name,
      weather: `${this.committedState!.weather.type}，${this.committedState!.weather.temperatureLevel}`,
      activity: activity.actionId,
      positive,
    };
    const signal = this.stopController.signal;
    let randomEventDescription: string | undefined;
    try {
      while (!signal.aborted) {
        try {
          if (randomEventDescription === undefined) {
            randomEventDescription = await generateRandomEvent(input, signal);
          }

          await this.enqueueStateChange(async () => {
            signal.throwIfAborted();
            await this.restoreAfterFailedCommit();
            // Redis 已提交但响应丢失时，恢复到的活动可能已经结束或换成下一项。
            if (
              this.committedState!.characters[characterId].currentActivity?.activityId !==
              activity.activityId
            ) {
              return;
            }
            const draftState = structuredClone(this.committedState!);
            const completionFact = settleActivity(
              draftState,
              this.characterDefinitions.get(characterId)!,
              this.map,
              this.characterNames,
              this.timezone,
              randomEventDescription,
            );
            await this.commitStateAndFacts(draftState, [completionFact]);
          });
          return;
        } catch (error) {
          if (signal.aborted) {
            return;
          }
          logger.error("活动完成失败，保留当前活动稍后重试", {
            characterId,
            activityId: activity.activityId,
            error,
          });
          await setTimeout(1_000, undefined, { signal });
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        throw error;
      }
    } finally {
      this.activityCompletionTasks.delete(activity.activityId);
    }
  }

  /** 状态与归档、通知任务一同提交 Redis 后发布内存快照；失败时撤下不确定的快照。 */
  private async commitStateAndFacts(
    draftState: WorldState,
    facts: WorldFact[],
    receipt?: RequestReceipt,
  ): Promise<void> {
    try {
      await commitWorldState(this.queues, this.committedState, draftState, facts, receipt);
      this.committedState = draftState;
    } catch (error) {
      this.committedState = null;
      throw error;
    }
  }

  /** 提交结果不确定时从 Redis 恢复；队列自行恢复未完成任务。 */
  private async restoreAfterFailedCommit(): Promise<void> {
    if (this.committedState !== null) {
      return;
    }
    const savedState = await loadWorldState();
    if (savedState === null) {
      throw new Error("已创建世界的持久化状态不存在，不能重新初始化覆盖");
    }
    this.committedState = savedState;
  }

  /** Promise 仅用于等待自己的队列结果，真正的流程在 processStateChanges 中顺序 await。 */
  private enqueueStateChange<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pendingStateChanges.push(async () => {
        try {
          resolve(await operation());
        } catch (error) {
          reject(error);
        }
      });
      if (!this.processingStateChanges) {
        void this.processStateChanges();
      }
    });
  }

  private async processStateChanges(): Promise<void> {
    this.processingStateChanges = true;
    while (this.pendingStateChanges.length) {
      await this.pendingStateChanges.shift()!();
    }
    this.processingStateChanges = false;
  }
}
