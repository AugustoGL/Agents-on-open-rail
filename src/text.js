/** Minúsculas, sin tildes y con espacios simples, para comparar nombres ("Cancha 1" ~ "cancha  1"). */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
