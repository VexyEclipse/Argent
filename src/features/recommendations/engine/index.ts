export * from "./types";
export { buildProfile, libraryStats, topPeople, engagementWeight, support, type Profile, type PersonAffinity } from "./profile";
export { scoreCandidates, isEligible, DEFAULT_WEIGHTS, hash01 } from "./score";
export { diversify, itemSimilarity } from "./rerank";
export { recommend, type RecommendationResult, type PersonalSection, type EngineInput } from "./sections";
