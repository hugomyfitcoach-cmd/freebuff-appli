/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as answers from "../answers.js";
import type * as checkins from "../checkins.js";
import type * as coach from "../coach.js";
import type * as crons from "../crons.js";
import type * as customFoods from "../customFoods.js";
import type * as dashboard from "../dashboard.js";
import type * as helpers from "../helpers.js";
import type * as journal from "../journal.js";
import type * as meals from "../meals.js";
import type * as media from "../media.js";
import type * as metrics from "../metrics.js";
import type * as off from "../off.js";
import type * as onboarding from "../onboarding.js";
import type * as photos from "../photos.js";
import type * as push from "../push.js";
import type * as resources from "../resources.js";
import type * as steps from "../steps.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  answers: typeof answers;
  checkins: typeof checkins;
  coach: typeof coach;
  crons: typeof crons;
  customFoods: typeof customFoods;
  dashboard: typeof dashboard;
  helpers: typeof helpers;
  journal: typeof journal;
  meals: typeof meals;
  media: typeof media;
  metrics: typeof metrics;
  off: typeof off;
  onboarding: typeof onboarding;
  photos: typeof photos;
  push: typeof push;
  resources: typeof resources;
  steps: typeof steps;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
