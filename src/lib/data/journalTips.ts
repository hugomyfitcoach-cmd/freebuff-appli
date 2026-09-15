/**
 * Bibliothèque officielle des 50 astuces G-FLUX — carte « Astuce du jour »
 * du Journal alimentaire (client uniquement).
 *
 * Rotation déterministe par jour :
 *  - une seule astuce par jour, identique toute la journée (et à chaque refresh) ;
 *  - jamais la même astuce deux jours consécutifs ;
 *  - toutes les astuces reviennent au fil des jours (cycle complet de 50).
 */

export const JOURNAL_TIPS: readonly string[] = [
	'Les petits extras comptent aussi. Un filet d’huile, du fromage râpé ou quelques bouchées peuvent vite s’additionner. Pense à les tracker.',
	'Cru ou cuit : choisis une méthode et garde-la. La régularité est plus importante que de chercher la perfection.',
	'L’huile est facile à sous-estimer. Une cuillère versée directement à la poêle peut représenter bien plus que prévu.',
	'Un repas au restaurant n’annule rien. Fais simplement la meilleure estimation possible et reprends ton tracking normalement au repas suivant.',
	'Ne cherche pas à compenser un repas plus riche. Reviens simplement à ta structure habituelle.',
	'Le week-end compte autant que la semaine. Deux journées très différentes peuvent réduire fortement le déficit créé du lundi au vendredi.',
	'Une journée parfaite n’est pas nécessaire. C’est la moyenne de plusieurs jours qui fait évoluer ta composition corporelle.',
	'Pèse surtout ce qui est difficile à estimer : huiles, féculents, fromage, oléagineux, sauces et produits très denses.',
	'La précision n’a pas besoin d’être obsessionnelle. Concentre-toi surtout sur les aliments qui peuvent réellement faire varier ton total calorique.',
	'Une portion indiquée sur un emballage n’est pas forcément ta portion. Vérifie toujours la quantité réellement consommée.',
	'Répartis tes protéines dans la journée. C’est souvent plus simple que d’essayer de tout rattraper au dîner.',
	'Si tes protéines sont basses le soir, anticipe : ajoute une source protéinée dès le petit-déjeuner ou le déjeuner.',
	'Perdre du poids n’est pas le seul objectif. On cherche surtout à perdre du gras tout en conservant un maximum de muscle.',
	'Plus vite n’est pas toujours mieux. Un déficit trop agressif peut rendre l’alimentation plus difficile à tenir et impacter tes performances.',
	'La faim est une information. Si elle devient très forte plusieurs jours de suite, observe ton sommeil, tes repas et leur volume.',
	'Avant de réduire encore les calories, augmente parfois simplement le volume de tes repas : légumes, fruits et aliments riches en eau peuvent aider.',
	'Les calories liquides rassasient souvent peu. Jus, sodas, alcool et cafés très enrichis peuvent vite monter.',
	'Une envie de manger n’est pas toujours de la faim. Demande-toi si tu mangerais aussi un vrai repas à ce moment-là.',
	'Ne juge pas ta progression sur une seule pesée. Eau, sel, digestion et glycogène peuvent faire varier ton poids rapidement.',
	'Regarde la tendance, pas le chiffre du jour. Plusieurs pesées donnent une image bien plus fiable de ta progression.',
	'Après un repas salé ou riche en glucides, la balance peut monter sans prise de gras. Laisse quelques jours avant de conclure.',
	'Un poids stable peut cacher une progression. Mensurations, photos et performances apportent une autre lecture.',
	'Bouger davantage n’oblige pas à faire plus de sport. Quelques milliers de pas supplémentaires peuvent déjà augmenter ta dépense quotidienne.',
	'Ton objectif de pas n’a pas besoin d’être parfait chaque jour. Cherche surtout une moyenne régulière sur la semaine.',
	'Une mauvaise journée n’appelle pas une mauvaise semaine. Le meilleur moment pour reprendre ta structure est simplement le prochain repas.',
	'Ne garde pas toutes tes calories pour le soir si cela te fait craquer avant. Répartis-les selon les moments où tu en as réellement besoin.',
	'Ton tracking doit rester vivable. Mieux vaut être précise à 90 % pendant des mois que parfaite trois jours puis abandonner.',
	'Un aliment n’est pas "bon" ou "mauvais". C’est sa place dans l’ensemble de ta journée qui compte.',
	'Plus de protéines ne signifie pas zéro glucide. Chaque macro a sa place dans une structure bien calibrée.',
	'Dépasser une macro ponctuellement n’est pas un échec. Regarde d’abord l’ensemble de ta journée et ta moyenne sur plusieurs jours.',
	'Si tu connais ton repas du soir, planifie-le à l’avance. Tu verras immédiatement ce qu’il te reste pour le reste de la journée.',
	'Planifier ne veut pas dire tout contrôler. Cela permet simplement de prendre de meilleures décisions avant d’avoir faim.',
	'Quand tu cuisines une recette maison, pense à compter aussi les ingrédients "invisibles" : huile, beurre, sauces, crème ou fromage.',
	'Si tu ne connais pas exactement les calories d’un plat, fais une estimation raisonnable plutôt que de ne rien tracker du tout.',
	'Attention aux différences entre poids cru et poids cuit. L’eau perdue ou absorbée peut fortement changer le poids sans changer les calories totales.',
	'Un repas plus volumineux n’est pas forcément plus calorique. Le volume alimentaire peut au contraire aider à mieux gérer la faim.',
	'Si tu as souvent faim juste après un repas, regarde s’il contient suffisamment de protéines, de volume et de fibres.',
	'Garde une marge de flexibilité dans ta journée. Cela aide à gérer un imprévu sans avoir l’impression que tout est fichu.',
	'Une soirée plus riche ne nécessite pas de jeûner le lendemain. Reviens simplement à ton rythme habituel.',
	'Les aliments "healthy" peuvent aussi être très caloriques. Beurre de cacahuète, noix, granola ou avocat restent à doser selon ton objectif.',
	'Les protéines t’aident à préserver ta masse musculaire pendant une perte de gras. Pense à vérifier ton total en fin de journée.',
	'Si tes calories sont correctes mais tes protéines très basses, améliore d’abord la qualité de la répartition plutôt que de réduire davantage.',
	'Ton métabolisme ne se juge pas sur deux jours. Les ajustements doivent être faits à partir d’une tendance suffisamment longue.',
	'Si ton poids ne bouge pas pendant quelques jours, ne change rien trop vite. Une vraie tendance demande du recul.',
	'Les règles, le stress, le sommeil et le transit peuvent masquer temporairement une perte de gras sur la balance.',
	'Une bonne semaine n’est pas forcément une semaine parfaite. La régularité compte davantage que quelques écarts isolés.',
	'Quand tu hésites entre deux portions, utilise les Repères G-FLUX pour estimer rapidement plutôt que d’abandonner le tracking.',
	'Plus ton tracking est régulier, plus les ajustements du coaching sont précis. Les données servent à comprendre ce qui fonctionne réellement pour toi.',
	'Si ton objectif calorique est dépassé aujourd’hui, ne cherche pas à "rembourser" demain. Reviens simplement à ton plan habituel.',
	'Le meilleur plan est celui que tu peux répéter. Cherche une structure efficace, mais surtout suffisamment simple pour durer.',
];

/** Nombre de jours depuis l'epoch local (ex. 2026-09-15 → 20611) — un cran de rotation par jour. */
function dayNumber(iso: string): number {
	return Math.floor(new Date(iso + 'T12:00:00').getTime() / 86_400_000);
}

/** Renvoie l'astuce du jour pour la date ISO locale « yyyy-mm-dd » (stable toute la journée). */
export function journalTipForDay(iso: string): string {
	const n = dayNumber(iso);
	// Saut multiplicatif : 2654435761 ≡ 11 (mod 50), et 11 est premier avec 50
	// → cycle complet des 50 astuces, et deux jours consécutifs (écart de 11)
	// ne tombent jamais sur la même astuce.
	const offset = (n * 2654435761) % 50;
	return JOURNAL_TIPS[offset];
}
