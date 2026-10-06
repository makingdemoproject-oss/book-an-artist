'use strict';

/**
 * Booking lifecycle. Single source of truth for which transitions exist and who may make them.
 *
 *   pending     -> confirmed    (artist)
 *   confirmed   -> in_progress  (artist)
 *   in_progress -> completed    (artist)
 *   pending     -> cancelled    (artist or client)
 *   confirmed   -> cancelled    (artist or client)
 *
 * completed and cancelled are terminal.
 */
const STATUSES = Object.freeze(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']);

const TRANSITIONS = Object.freeze({
  pending: { confirmed: ['artist'], cancelled: ['artist', 'client'] },
  confirmed: { in_progress: ['artist'], cancelled: ['artist', 'client'] },
  in_progress: { completed: ['artist'] },
  completed: {},
  cancelled: {},
});

function allowedNextStatuses(from) {
  return Object.keys(TRANSITIONS[from] || {});
}

function isValidTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from][to]);
}

function canActorTransition(role, from, to) {
  return isValidTransition(from, to) && TRANSITIONS[from][to].includes(role);
}

function describeInvalidTransition(from, to) {
  const next = allowedNextStatuses(from);
  const allowed = next.length
    ? `Allowed transitions from '${from}': ${next.join(', ')}.`
    : `'${from}' is a terminal status and cannot be changed.`;
  return `Invalid status transition from '${from}' to '${to}'. ${allowed}`;
}

module.exports = {
  STATUSES,
  allowedNextStatuses,
  isValidTransition,
  canActorTransition,
  describeInvalidTransition,
};
