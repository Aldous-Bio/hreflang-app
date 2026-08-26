import stringSimilarity from "string-similarity";

export const AUTO_MATCH_THRESHOLD = 0.8;
export const REVIEW_THRESHOLD = 0.55;

export function handleSimilarity(handleA, handleB) {
  return stringSimilarity.compareTwoStrings(handleA ?? "", handleB ?? "");
}
