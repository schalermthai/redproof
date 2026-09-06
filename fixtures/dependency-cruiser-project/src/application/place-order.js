import { order } from '../domain/order.js';

export function placeOrder(id) {
  return order(id);
}
