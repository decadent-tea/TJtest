import { motion, useScroll, useSpring, useTransform } from "motion/react";

/** Decorative material study. The fixed plane moves more slowly than the workspace. */
export function WorkspaceAtmosphere() {
  const { scrollY } = useScroll();
  const smoothScroll = useSpring(scrollY, { stiffness: 80, damping: 30 });
  const y = useTransform(smoothScroll, [0, 1200], [0, -90]);
  return (
    <motion.div
      className="workspace-atmosphere"
      aria-hidden="true"
      style={{ y }}
    >
      <img
        src="/visuals/backgrounds/workspace-mineral-depth.webp"
        alt=""
        width="1672"
        height="941"
        decoding="async"
        fetchPriority="low"
      />
    </motion.div>
  );
}
