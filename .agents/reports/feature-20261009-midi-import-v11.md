# BT-MIDI-IMPORT-112 — Finalisation de la PR #111

Issue #112, base fraîche `1775b363531a5ea5c2cf16470eac3a9e6230d464`.
Worktree `.worktrees/beat-twin-midi-import-finalize-20261009-v11`, branche
`feat/midi-import-finalize-20261009-v11`. Canonique propre main égal origin/main.
Reprise FF des deux commits existants jusqu’à `ab43d01977f3e34685ceeb9bb1d8d32130edebd9`.
Aucun changement parser/store/codec ou dépendance nouvelle dans cette finalisation.

Avant : export local intégré, import préparé mais PR #111 encore draft. Après :
le parcours préparé permet aperçu des notes et tempo, discard sans mutation puis
Add explicite CAS, append atomique, undo ; les pistes/identité/tempo existants
restent préservés. Le sous-ensemble et refus restent ceux de NANODAW_MIDI_IMPORT.md.

Validation renouvelée dans ce worktree :
- `corepack pnpm install --offline --frozen-lockfile --ignore-scripts` : 257 paquets
  cache, zéro téléchargement ; midi-file 1.2.4 MIT inchangé.
- `corepack pnpm run build:packages` : vert, builds seuls sans démarrer de service.
- `corepack pnpm --filter @beat-twin/playground test` : 23 fichiers/201 tests verts,
  incluant framing/bytes malformés/running status/tempo/controllers/budgets,
  export-roundtrip, PPQ3 tick7→20→accept→undo, CAS, atomicité et autosave.
- `corepack pnpm --filter @beat-twin/playground build` : TypeScript/Vite verts.
- Chrome local sur assets **production**, port5537 : 6/6 parcours (deux scénarios
  ×1440×900,768×1024,390×844), reduced motion ; preview/discard/storage inchangé,
  détails notes clavier, Add/clavier/focus, tempo124 préservé, undo exact. Nouveau
  scénario : Undo réel après une seconde preview rend Add disabled ; fichier
  malformé refuse sans modification, fichier valide corrige sans save implicite.
- Axe4.11.1 ciblé panneau étendu avec contexte document réel : ancien h3 après h1
  produit heading-order aux trois tailles. Correction ciblée h2, aucune règle
  désactivée : final zéro violation et zéro incomplete aux trois tailles.
  `MidiImportPanel.test.tsx` 2/2 et build renouvelés après ce seul changement UI.
- Screenshots aux trois tailles revues : tableau et actions lisibles, focus visible,
  Add à l’intérieur viewport, chooser/summary44px minimum assertés. Pageerrors[]
  pour les six parcours. Ce n’est pas une qualification WCAG globale de l’app.
- `git diff --check` vert. Actions GitHub disabled, aucune CI distante affirmée.

Recette reviewer : install cache/build ci-dessus, puis depuis apps/playground :
`corepack pnpm exec vite preview --host 127.0.0.1 --port <port distinct>`.
Config temporaire `/tmp/beat-midi-v11-playwright.config.ts` donne testDir MIDI,
3projects/1worker, production5537 et Chromium1229 explicitement installé. Adapter
worktree et port à une revue indépendante ; ne réutiliser aucun serveur existant.
`BEAT_MIDI_AXE_SCRIPT=<axe.min.js installé> apps/playground/node_modules/.bin/playwright test --config <config>`.
L’env axe injecte seulement le script de QA dans la page, sans nouvelle dépendance
ni couplage produit. Preuves non suivies `/tmp/beat-twin-v11-browser/results`.
Assets finals : index-CPcK1dcc.js (ancien index-CYQynaQU.js remplacé après heading).

Limites : fixtures MIDI synthétiques, pas média privé, écoute humaine, audio réel,
Bitwig, Gateway, S25, provider ou device. Notes-only, pas reconstruction de session,
voice mapping GM/sustain/tempo variable non pris en charge. L’ancien scan axe v2
avait une portée insuffisante pour ce défaut de contexte ; cette revue élargit la
preuve ciblée, sans transformer les résultats historiques en validation actuelle.
Export #84 et Duo #89 sont distincts, aucune branche ni ancien worktree supprimé.
Aucun push/ready/merge avant revue exacte renouvelée ; parent gère livraison.
La vague11 sera la dernière avant la pause demandée, sans activation v12.

## Delta après revue focus (ancien candidat dafda10)

Le reviewer a reproduit un chooser focusé qui perdait le focus vers BODY après
lecture, car disabled puis remount inputKey. Le champ reste maintenant le même
nœud DOM et focusable pendant lecture (`aria-busy`). Seule sa valeur native est
vidée, ce qui autorise une reselection du même fichier sans restauration de focus
heuristique. Si l’utilisateur déplace le focus vers un autre contrôle pendant
lecture, celui-ci est conservé. Une nouvelle sélection invalide aussi la génération
précédente ; même un refus oversize immédiat enlève loading et ignore la preview tardive.

Sur le delta final : composant ciblé 4/4, build TypeScript/Vite vert, Chrome9/9
(3scénarios ×3tailles) dont File.arrayBuffer différé synthétique, ownership positif,
utilisateur quittant le champ, même nom de fichier, malformed/oversize et nouvelle
sélection oversize pendant lecture. Preview/discard/Add/undo/stale et axe0v0incomplete
revalidés dans les mêmes parcours. Assets finals `index-DzKsFlSu.js`, port5537.
Suite201/parser/store inchangés depuis le premier candidat ; pas de rerun large.
Cette correction attend la revue delta indépendante du nouveau SHA.
