// Logique visuelle de l'écran « Login » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { role: 'coach', show: false, email: '', pwd: '' }; }
  renderVals() {
    const coach = this.state.role === 'coach';
    return {
      indL: coach ? '4px' : '50%',
      coachFg: coach ? '#0d7c36' : '#7B857F', clientFg: coach ? '#7B857F' : '#0d7c36',
      coachFw: coach ? 900 : 700, clientFw: coach ? 700 : 900,
      pickCoach: () => this.setState({ role: 'coach' }), pickClient: () => this.setState({ role: 'client' }),
      email: this.state.email, setEmail: (e) => this.setState({ email: e.target.value }),
      pwd: this.state.pwd, setPwd: (e) => this.setState({ pwd: e.target.value }),
      ptype: this.state.show ? 'text' : 'password', toggleShow: () => this.setState({ show: !this.state.show }),
      eyeLabel: this.state.show ? 'Masquer le mot de passe' : 'Afficher le mot de passe',
      eyeOn: this.state.show, eyeOff: !this.state.show
    };
  }
}
