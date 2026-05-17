import type { ActivityItem } from "@/lib/activity/activity-view";

export type {
  ActivityDetailField,
  ActivityItem,
  ActivityTrigger,
} from "@/lib/activity/activity-view";

export interface ActivityPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
}

export type ActivityTriggerFilter = "all" | ActivityItem["trigger"];
export type ActivityEpisodeTypeFilter = "all" | ActivityItem["episodeType"];

export interface ActivityQueryFilters {
  startDate: string;
  endDate: string;
  trigger: ActivityTriggerFilter;
  episodeType: ActivityEpisodeTypeFilter;
  keyword: string;
}

export const DEFAULT_ACTIVITY_QUERY_FILTERS: ActivityQueryFilters = {
  startDate: "",
  endDate: "",
  trigger: "all",
  episodeType: "all",
  keyword: "",
};

export interface ActivityResponsePayload {
  data?: {
    events?: ActivityItem[];
    pagination?: ActivityPagination;
  };
}
