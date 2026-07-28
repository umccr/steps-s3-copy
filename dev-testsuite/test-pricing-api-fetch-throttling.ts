import {
  fetchColdStorageRetrievalCosts,
  fetchCrossRegionCosts,
  fetchComputeCosts,
} from "../packages/steps-s3-copy/lambda/common/cost-estimation";

// number of simulated lambdas to run
const REPEATS = 100;

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

const COLORS = { green: "\x1b[32m", red: "\x1b[31m", reset: "\x1b[0m" };
const okSym = (v: boolean) =>
  v ? `${COLORS.green}✔${COLORS.reset}` : `${COLORS.red}✖${COLORS.reset}`;

results.forEach(([cold, cross, compute], idx) => {
  const coldOk = isNonEmpty(cold);
  const crossOk = isNonEmpty(cross);
  const computeOk = isNonEmpty(compute.lambda);

  console.log(
    `run ${idx + 1}: cold=${okSym(coldOk)} cross=${okSym(
      crossOk,
    )} compute=${okSym(computeOk)}`,
  );
});
