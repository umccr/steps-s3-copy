import {
  fetchColdStorageRetrievalCosts,
  fetchCrossRegionCosts,
  fetchComputeCosts,
} from "../packages/steps-s3-copy/lambda/common/cost-estimation";

// number of simulated lambdas to run
const REPEATS = 5;

// Launch all `REPEATS` runs at the same time and wait for them to finish.
const tasks = Array.from({ length: REPEATS }, () =>
  Promise.all([
    fetchColdStorageRetrievalCosts("ap-southeast-2"),
    fetchCrossRegionCosts("ap-southeast-2"),
    fetchComputeCosts("ap-southeast-2"),
  ]),
);

const results = await Promise.all(tasks);
// check if the fetched data is non-empty --> means the API calls were successful
const isNonEmpty = (v: any) => {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
};

results.forEach(([cold, cross, compute], idx) => {
  const cold_ok = isNonEmpty(cold);
  const cross_ok = isNonEmpty(cross);
  const compute_ok = isNonEmpty(compute.lambda);
  // Some colors for the console output to make it easier to see which runs succeeded and which failed.
  const COLORS = { green: "\x1b[32m", red: "\x1b[31m", reset: "\x1b[0m" };
  const okSym = (v: boolean) =>
    v ? `${COLORS.green}✔${COLORS.reset}` : `${COLORS.red}✖${COLORS.reset}`;

  console.log(
    `run ${idx + 1}: cold=${okSym(cold_ok)} cross=${okSym(
      cross_ok,
    )} compute=${okSym(compute_ok)}`,
  );
});
