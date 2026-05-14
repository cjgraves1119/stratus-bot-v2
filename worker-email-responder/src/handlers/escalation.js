/**
 * Escalation — short ack + CC Jay Florendo.
 * Does NOT attempt to answer the question.
 */

import { checkJayCcCap } from "../rate-limit.js";

export async function handleEscalation(env, ctx) {
  const { decision } = ctx;

  const jayCap = await checkJayCcCap(env);
  if (!jayCap.allowed) {
    // Daily Jay CC limit reached: still ack, but don't CC
    return {
      kind: "escalation_no_cc",
      bodySegments: [
        `Thanks for reaching out!`,
        `This one is outside what I can confidently help with as Chris's AI assistant, so it'll get picked up by a teammate as soon as they're available.`,
        `Appreciate your patience!`,
      ],
    };
  }

  return {
    kind: "escalation",
    bodySegments: [
      `Thanks for reaching out!`,
      `This one is outside what I can confidently handle as Chris's AI assistant — looping in Jay Florendo (CC'd) who can take it from here. He'll have full context once he sees this.`,
      `Appreciate your patience!`,
    ],
    extraCcJay: true,
  };
}
