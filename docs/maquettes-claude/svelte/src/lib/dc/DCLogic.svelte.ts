/**
 * Équivalent Svelte 5 (runes) de la classe de logique des maquettes (DCLogic).
 * - `state` est réactif (rune $state) ;
 * - `setState(patch)` fusionne le patch dans l'état ;
 * - chaque écran appelle `renderVals()` dans un `$derived` : toute lecture de `this.state` est suivie,
 *   le rendu se met donc à jour comme dans la maquette d'origine.
 */
export class DCLogic<S extends Record<string, any> = Record<string, any>> {
  props: Record<string, any>;
  state = $state<S>({} as S);
  constructor(props: Record<string, any> = {}) {
    this.props = props;
  }
  setState(patch: Partial<S>) {
    Object.assign(this.state as object, patch);
  }
  renderVals(): Record<string, any> {
    return {};
  }
}
