// Stable hexagonal slots: later registrations never relocate existing agents.
export function agentSlots(agents) {
  const slots = new Map();
  let index = 0;
  for (const agent of agents) {
    if (!index) slots.set(agent.id, { x: 0, z: 0 });
    else {
      let offset = index - 1,
        ring = 1;
      while (offset >= ring * 6) {
        offset -= ring * 6;
        ring++;
      }
      const seat = ring === 1 ? [0, 4, 2, 1, 5, 3][offset] : offset;
      const angle = -Math.PI / 3 + (seat / (ring * 6)) * Math.PI * 2;
      slots.set(agent.id, {
        x: Math.cos(angle) * ring * 5.8,
        z: Math.sin(angle) * ring * 5.8,
      });
    }
    index++;
  }
  return slots;
}

// These are send animations, not simulated delivery acknowledgements.
export function packetProgress(sentAt, clock, lifetime = 1800) {
  const age = clock - sentAt;
  return age >= 0 && age < lifetime ? age / lifetime : null;
}
