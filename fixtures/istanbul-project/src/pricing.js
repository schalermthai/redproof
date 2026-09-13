export function discount(total, member) {
  if (member) {
    return total * 0.9;
  }
  return total;
}

export function shipping(total) {
  return total > 50 ? 0 : 5;
}
