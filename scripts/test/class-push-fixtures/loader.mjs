const fixtureUrl = (name) => new URL(`./${name}`, import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'web-push') return { url: fixtureUrl('mock-web-push.mjs'), shortCircuit: true };
  if (specifier === './store.mjs' && (context.parentURL.endsWith('/send-class-push.mjs') || context.parentURL.endsWith('/delivery.mjs'))) {
    return { url: fixtureUrl('mock-store.mjs'), shortCircuit: true };
  }
  if (specifier === './notify-log.mjs' && (context.parentURL.endsWith('/send-class-push.mjs') || context.parentURL.endsWith('/delivery.mjs'))) {
    return { url: fixtureUrl('mock-notify-log.mjs'), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
