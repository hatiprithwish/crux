import { z } from "zod";
import { ZMetricBase } from "./MetricsCommon";

export const ZCreateMetricApiRequest = z.object({
  metric: ZMetricBase,
});
export type CreateMetricApiRequest = z.infer<typeof ZCreateMetricApiRequest>;
