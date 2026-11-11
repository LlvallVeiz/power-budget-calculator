'use strict';

/**
 * errors.js — error types used across the calculator.
 *
 * Every public function validates its input and throws one of these errors
 * with a message that names the offending field, so a bad scenario file
 * fails loudly instead of silently producing a wrong lifetime estimate.
 */

/** Thrown when a scenario, battery, profile or regulator description is malformed. */
class ValidationError extends Error {
  /**
   * @param {string} message human-readable description of what is wrong
   * @param {string} [field] dotted path of the offending field, e.g. "battery.capacity_mAh"
   */
  constructor(message, field = '') {
    super(field ? `${field}: ${message}` : message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** Thrown when a calculation cannot produce a finite, meaningful result. */
class CalculationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CalculationError';
  }
}

module.exports = { ValidationError, CalculationError };
