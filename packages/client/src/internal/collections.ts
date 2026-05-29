export const chunksOf = <A>(
  items: ReadonlyArray<A>,
  size: number,
): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};
