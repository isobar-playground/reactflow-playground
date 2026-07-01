// resolved-prompt (CONTEXT.md): the final prompt a Generation Node uses —
// the text of all connected Static Text References, in edge order,
// concatenated with the node's own local prompt field.

export function resolvedPrompt(textRefs: string[], localPrompt: string): string {
  return [...textRefs, localPrompt].filter((part) => part.length > 0).join(" ");
}
