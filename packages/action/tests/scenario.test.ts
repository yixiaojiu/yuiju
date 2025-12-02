import { describe, it, expect, beforeEach, vi } from 'vitest';
import dayjs from 'dayjs';
import { worldState } from '@/state/world-state';
import { charactorState } from '@/state/charactor-state';
import { Activity, WorldLocation } from '@/types/everything';
import { timeConfig } from '@/config/time';
import { getAction } from '@/config/action-registry';
import { shortTermMemory } from '@/memory/short-term';

// 通过模块级 mock 控制 LLM 输出，驱动 tick 的行为
let nextChoice: { action: string; reason: string } = { action: 'NO_CHANGE', reason: 'default' };
vi.mock('@/llm/llm-client', () => {
  return {
    llmClient: {
      chooseAction: async () => nextChoice,
    },
  };
});

// 在 mock 完成后再导入 tick，确保其使用到被替换的 llmClient
import { tick } from '@/engine/tick';
import { ActionId } from '@/types/action';

beforeEach(() => {
  worldState.updateTime(dayjs().hour(6).minute(0).second(0));
  charactorState.reset();
  shortTermMemory.clear();
  nextChoice = { action: 'NO_CHANGE', reason: 'default' };
});

describe('tick with mocked LLM', () => {
  it('MORNING_WAKE gate: choose WAKE_UP updates activity and memory', async () => {
    worldState.updateTime(dayjs().hour(6).minute(30));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.SLEEPING);
    nextChoice = { action: 'WAKE_UP', reason: '起床开始新一天' };

    const res = await tick();
    expect(res.executed).toBe('WAKE_UP');
    expect(res.reason).toBe('起床开始新一天');
    expect(charactorState.activity).toBe(Activity.WAKE_UP);
    const meta = getAction(ActionId.WAKE_UP)!;
    expect(res.nextDelayMs).toBe((meta.cooldownSec ?? 0) * 1000);
    const last = shortTermMemory.list().at(-1)!;
    expect(last.action).toBe('WAKE_UP');
    expect(last.reason).toBe('起床开始新一天');
  });

  it('GO_TO_SCHOOL gate: choose NO_CHANGE keeps state, delay uses gate config', async () => {
    worldState.updateTime(dayjs().hour(9).minute(0));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.WAKE_UP);
    nextChoice = { action: 'NO_CHANGE', reason: '再等一会出发' };

    const res = await tick();
    expect(res.executed).toBe('NO_CHANGE');
    expect(res.reason).toBe('再等一会出发');
    expect(charactorState.location).toBe(WorldLocation.HOME);
    expect(charactorState.activity).toBe(Activity.WAKE_UP);
    expect(res.nextDelayMs).toBe(timeConfig.gates.noChangeNextSec.GO_TO_SCHOOL * 1000);
    const last = shortTermMemory.list().at(-1)!;
    expect(last.action).toBe('NO_CHANGE');
    expect(last.reason).toBe('再等一会出发');
  });

  it('GO_TO_SCHOOL gate: choose GO_TO_SCHOOL moves to school and study', async () => {
    worldState.updateTime(dayjs().hour(9).minute(0));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.WAKE_UP);
    nextChoice = { action: 'GO_TO_SCHOOL', reason: '按时到校' };

    const res = await tick();
    expect(res.executed).toBe('GO_TO_SCHOOL');
    expect(res.reason).toBe('按时到校');
    expect(charactorState.location).toBe(WorldLocation.SCHOOL);
    expect(charactorState.activity).toBe(Activity.STUDY_AT_SCHOOL);
    const meta = getAction(ActionId.GO_TO_SCHOOL)!;
    expect(res.nextDelayMs).toBe((meta.cooldownSec ?? 0) * 1000);
    const last = shortTermMemory.list().at(-1)!;
    expect(last.action).toBe('GO_TO_SCHOOL');
    expect(last.reason).toBe('按时到校');
  });

  it('GO_HOME gate: choose GO_HOME returns home and idle', async () => {
    worldState.updateTime(dayjs().hour(timeConfig.gates.goHomeAfterHour).minute(0));
    charactorState.setLocation(WorldLocation.SCHOOL);
    charactorState.setActivity(Activity.STUDY_AT_SCHOOL);
    nextChoice = { action: 'GO_HOME', reason: '放学回家' };

    const res = await tick();
    expect(res.executed).toBe('GO_HOME');
    expect(res.reason).toBe('放学回家');
    expect(charactorState.location).toBe(WorldLocation.HOME);
    expect(charactorState.activity).toBe(Activity.IDLE_AT_HOME);
    const meta = getAction(ActionId.GO_HOME)!;
    expect(res.nextDelayMs).toBe((meta.cooldownSec ?? 0) * 1000);
  });

  it('EVENING_SLEEP gate: choose SLEEP sets sleeping', async () => {
    worldState.updateTime(dayjs().hour(timeConfig.scenes.eveningStartHour).minute(0));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.IDLE_AT_HOME);
    nextChoice = { action: 'SLEEP', reason: '困了要睡觉' };

    const res = await tick();
    expect(res.executed).toBe('SLEEP');
    expect(res.reason).toBe('困了要睡觉');
    expect(charactorState.activity).toBe(Activity.SLEEPING);
    const meta = getAction(ActionId.SLEEP)!;
    expect(res.nextDelayMs).toBe((meta.cooldownSec ?? 0) * 1000);
  });
});

describe('full day flow', () => {
  it('from wake up to sleep in one day', async () => {
    // 06:30 起床
    worldState.updateTime(dayjs().hour(6).minute(30));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.SLEEPING);
    nextChoice = { action: 'WAKE_UP', reason: '起床' };
    const r1 = await tick();
    expect(r1.executed).toBe('WAKE_UP');
    expect(charactorState.activity).toBe(Activity.WAKE_UP);

    // 09:00 去学校
    worldState.updateTime(dayjs().hour(9).minute(0));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.WAKE_UP);
    nextChoice = { action: 'GO_TO_SCHOOL', reason: '去学校' };
    const r2 = await tick();
    expect(r2.executed).toBe('GO_TO_SCHOOL');
    expect(charactorState.location).toBe(WorldLocation.SCHOOL);
    expect(charactorState.activity).toBe(Activity.STUDY_AT_SCHOOL);

    // 17:00 放学回家
    worldState.updateTime(dayjs().hour(timeConfig.gates.goHomeAfterHour).minute(0));
    charactorState.setLocation(WorldLocation.SCHOOL);
    charactorState.setActivity(Activity.STUDY_AT_SCHOOL);
    nextChoice = { action: 'GO_HOME', reason: '回家' };
    const r3 = await tick();
    expect(r3.executed).toBe('GO_HOME');
    expect(charactorState.location).toBe(WorldLocation.HOME);
    expect(charactorState.activity).toBe(Activity.IDLE_AT_HOME);

    // 21:00 晚上睡觉
    worldState.updateTime(dayjs().hour(timeConfig.scenes.eveningStartHour).minute(0));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.IDLE_AT_HOME);
    nextChoice = { action: 'SLEEP', reason: '睡觉' };
    const r4 = await tick();
    expect(r4.executed).toBe('SLEEP');
    expect(charactorState.activity).toBe(Activity.SLEEPING);

    const mem = shortTermMemory.list();
    expect(mem.map(m => m.action)).toEqual(['WAKE_UP', 'GO_TO_SCHOOL', 'GO_HOME', 'SLEEP']);
  });
});
