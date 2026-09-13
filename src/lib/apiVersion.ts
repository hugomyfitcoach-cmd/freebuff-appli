/**
 * Version du CONTRAT API attendue par CE bundle frontend.
 *
 * Doit rester ÉGALE à CURRENT_API_VERSION du backend déployé
 * (src/convex/appVersion.ts). Toute rupture de contrat se fait en 3 temps :
 *  1. ajouter côté BFF/backend la compatibilité avec l'ANCIEN format des
 *     clients déjà déployés (ne plus jamais casser brutalement) ;
 *  2. déployer le backend (npm run deploy) ;
 *  3. incrémenter les deux constantes ensemble dans le commit frontend.
 *
 * Historique :
 * - 2 : recherche paginée { items, hasMore } (12/09/2026) ;
 * - 3 : garde-fous contrat + détection d'obsolescence (13/09/2026).
 */
export const FRONTEND_API_VERSION = 3;
