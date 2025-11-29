import { BehaviourTree, State } from 'mistreevous';
import { PartOfDayWindow } from '@/config';
import { charactorState } from '@/state/charactor-state';
import { worldState } from '@/state/world-state';
import { Activity, WorldLocation } from '@/types/everything';

const definition = `root {
    selector {
      sequence {
        condition [CheckLocation, "home"]
        selector {
          sequence {
            condition [CheckNotActivityState, "wake_up"]
            action [MorningWakeUpAction] 
          }
          sequence {
            action [GoToSchoolAction]
          }
        }
      }
      sequence {
        condition [CheckLocation, "school"]
        selector {
          sequence {
            condition [CheckNotActivityState, "study_at_school"]
            action [StudyAtSchoolAction]
          }
          action [GoHomeFromSchoolAction]
        }
      }
      sequence {
        condition [CheckLocation, "home"]
        selector {
          sequence {
            condition [CheckNotActivityState, "idle_at_home"]
            action [IdleAtHomeAction]
          }
          sequence {
            condition [CheckNotActivityState, "sleeping"]
            action [EveningSleepAction]
          }
        }
      }
    }
  }
`;

const agent = {
  CheckLocation(location: WorldLocation) {
    return charactorState.location === location;
  },

  CheckNotActivityState(activity: Activity) {
    return charactorState.activity !== activity;
  },

  MorningWakeUpAction() {
    const time = worldState.time;
    if (time.hour() < PartOfDayWindow.morning.startHour) {
      return State.FAILED;
    }

    if (charactorState.activity !== Activity.SLEEPING) {
      return State.FAILED;
    }

    charactorState.setActivity(Activity.WAKE_UP);

    return State.SUCCEEDED;
  },

  GoToSchoolAction() {
    if (charactorState.activity !== Activity.WAKE_UP) {
      return State.FAILED;
    }

    charactorState.setLocation(WorldLocation.SCHEOOL);

    return State.SUCCEEDED;
  },

  StudyAtSchoolAction() {
    if (charactorState.location !== WorldLocation.SCHEOOL) {
      return State.FAILED;
    }

    charactorState.setActivity(Activity.STUDY_AT_SCHOOL);

    return State.SUCCEEDED;
  },

  GoHomeFromSchoolAction() {
    const time = worldState.time;
    if (time.hour() < PartOfDayWindow.school.endHour) {
      return State.FAILED;
    }

    if (charactorState.location !== WorldLocation.SCHEOOL) {
      return State.FAILED;
    }
    charactorState.setLocation(WorldLocation.HOME);

    return State.SUCCEEDED;
  },

  IdleAtHomeAction() {
    if (charactorState.location !== WorldLocation.HOME) {
      return State.FAILED;
    }

    if (charactorState.activity === Activity.IDLE_AT_HOME) {
      return State.FAILED;
    }

    charactorState.setActivity(Activity.IDLE_AT_HOME);

    return State.SUCCEEDED;
  },

  EveningSleepAction() {
    const time = worldState.time;
    if (time.hour() < PartOfDayWindow.evening.startHour) {
      return State.FAILED;
    }

    if (charactorState.activity === Activity.SLEEPING) {
      return State.FAILED;
    }

    if (charactorState.activity !== Activity.IDLE_AT_HOME) {
      return State.FAILED;
    }

    charactorState.setActivity(Activity.SLEEPING);

    return State.SUCCEEDED;
  },
};

export function createBehaviourTree() {
  const tree = new BehaviourTree(definition, agent);

  return tree;
}
