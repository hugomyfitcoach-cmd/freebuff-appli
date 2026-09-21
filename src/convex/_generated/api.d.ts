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
import type * as appVersion from "../appVersion.js";
import type * as appointments from "../appointments.js";
import type * as checkins from "../checkins.js";
import type * as ciqual from "../ciqual.js";
import type * as ciqualNames from "../ciqualNames.js";
import type * as ciqualNutrients from "../ciqualNutrients.js";
import type * as ciqualSource from "../ciqualSource.js";
import type * as coach from "../coach.js";
import type * as crons from "../crons.js";
import type * as customFoods from "../customFoods.js";
import type * as dashboard from "../dashboard.js";
import type * as exercises from "../exercises.js";
import type * as foodImages from "../foodImages.js";
import type * as foodRanking from "../foodRanking.js";
import type * as googleCalendar from "../googleCalendar.js";
import type * as helpers from "../helpers.js";
import type * as journal from "../journal.js";
import type * as maintenance from "../maintenance.js";
import type * as mealPlans from "../mealPlans.js";
import type * as meals from "../meals.js";
import type * as media from "../media.js";
import type * as metrics from "../metrics.js";
import type * as notifications from "../notifications.js";
import type * as off from "../off.js";
import type * as onboarding from "../onboarding.js";
import type * as photos from "../photos.js";
import type * as push from "../push.js";
import type * as reminderPush from "../reminderPush.js";
import type * as resources from "../resources.js";
import type * as sport from "../sport.js";
import type * as sportCatalog from "../sportCatalog.js";
import type * as steps from "../steps.js";
import type * as tools from "../tools.js";
import type * as training from "../training.js";
import type * as trainingAssign from "../trainingAssign.js";
import type * as trainingClient from "../trainingClient.js";
import type * as users from "../users.js";
import type * as webPushVendors from "../webPushVendors.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  answers: typeof answers;
  appVersion: typeof appVersion;
  appointments: typeof appointments;
  checkins: typeof checkins;
  ciqual: typeof ciqual;
  ciqualNames: typeof ciqualNames;
  ciqualNutrients: typeof ciqualNutrients;
  ciqualSource: typeof ciqualSource;
  coach: typeof coach;
  crons: typeof crons;
  customFoods: typeof customFoods;
  dashboard: typeof dashboard;
  exercises: typeof exercises;
  foodImages: typeof foodImages;
  foodRanking: typeof foodRanking;
  googleCalendar: typeof googleCalendar;
  helpers: typeof helpers;
  journal: typeof journal;
  maintenance: typeof maintenance;
  mealPlans: typeof mealPlans;
  meals: typeof meals;
  media: typeof media;
  metrics: typeof metrics;
  notifications: typeof notifications;
  off: typeof off;
  onboarding: typeof onboarding;
  photos: typeof photos;
  push: typeof push;
  reminderPush: typeof reminderPush;
  resources: typeof resources;
  sport: typeof sport;
  sportCatalog: typeof sportCatalog;
  steps: typeof steps;
  tools: typeof tools;
  training: typeof training;
  trainingAssign: typeof trainingAssign;
  trainingClient: typeof trainingClient;
  users: typeof users;
  webPushVendors: typeof webPushVendors;
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
