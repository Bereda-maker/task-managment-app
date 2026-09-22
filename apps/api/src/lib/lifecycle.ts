/** Process-wide "we are shutting down" flag, so /ready can tell the load balancer to stop sending traffic. */
let draining = false;
export const isDraining = () => draining;
export const startDraining = () => {
  draining = true;
};

/** Test hook. */
export const setDraining = (value: boolean) => {
  draining = value;
};
