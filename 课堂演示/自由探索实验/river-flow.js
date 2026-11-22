export const groupCount = 12;
export const roundDuration = 7.6;

export function arrangeRound(downstreamGroups) {
  // 组数和速度只用于两次课堂推演的等时对照。
  const docks = [
    ['east', groupCount - downstreamGroups, 0.56, 0.85, 2.40],
    ['downstream', downstreamGroups, 0.65, 0.86, 2.70],
  ];
  return docks.flatMap(([dock, groupTotal, first, gap, travel]) =>
    Array.from({ length: groupTotal }, (_, order) => {
      const leaves = first + order * gap;
      return { dock, order, leaves, arrives: leaves + travel };
    }));
}

export function countArrivals(groups, elapsed) {
  return groups.reduce((count, group) => count + Number(group.arrives <= elapsed), 0);
}
