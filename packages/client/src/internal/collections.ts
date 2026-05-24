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

export const keyedResults = <A extends { readonly key: string }, B>(
  entries: ReadonlyArray<A>,
  results: ReadonlyArray<B>,
) => {
  const out: Record<string, B> = {};
  for (let index = 0; index < entries.length; index++) {
    out[entries[index]!.key] = results[index]!;
  }
  return out;
};
