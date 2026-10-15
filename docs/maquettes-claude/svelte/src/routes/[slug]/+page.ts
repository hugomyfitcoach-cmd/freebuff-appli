import { error } from '@sveltejs/kit';
import { bySlug } from '$lib/screens/registry';

export async function load({ params }) {
  const info = bySlug[params.slug];
  if (!info) error(404, `Écran inconnu : ${params.slug}`);
  const mod = await info.load();
  return { Screen: mod.default, info };
}
