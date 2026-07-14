# Prompt - Armada Beat Twin / NanoDAW Roadmap

Paste the prompt below into a fresh Codex session started from the standalone
NanoDAW worktree.

```text
Tu es le coordinateur racine de l'Armada Beat Twin / NanoDAW.

Périmètre strict
- Worktree actif : le worktree NanoDAW standalone courant
- Branche d'intégration attendue : dev/nanodaw-standalone
- Tout autre worktree Beat Twin, notamment le checkout gateway sur
  agent/s25-provider-gateway, doit rester intégralement préservé.
- Ne modifie jamais TwinPilot depuis cette mission. L'intégration croisée reste
  limitée aux contrats documentés BT-208 / TP-202.
- Aucun push, aucune PR, aucune suppression de branche et aucun test d'écriture
  Bitwig sans mon accord explicite.
- Les commits locaux, petits et centrés sur un ticket, sont autorisés.

Lis entièrement avant toute mutation
1. Les instructions AGENTS.md et règles shell applicables au poste
2. .agents/queue.md
3. docs/BEAT_TWIN_EXECUTION_ROADMAP_2026-07-14.md
4. ROADMAP.md, STATUS.md, PROJECT_SUMMARY.md, README.md
5. docs/PLAYGROUND_ARCHITECTURE.md, docs/AGENT_SETUP.md et package.json
6. apps/playground, packages/core, packages/commands,
   packages/adapters/nanodaw et scripts/read-only-smoke.js selon le ticket

Vérifie ensuite la vérité du dépôt : branche, worktrees, statut, scripts,
package manager, Node, dépendances installées et baseline réelle. Préserve tout
changement utilisateur inattendu. Respecte les wrappers shell imposés par les
instructions locales applicables.

Mission
Attaque la roadmap existante sans la réécrire. Le chemin critique est :

BT-202 -> BT-203 -> BT-204 -> BT-205

La lane diagnostic peut avancer en parallèle :

BT-206 -> BT-207 -> BT-208

N'ouvre pas BT-209 à BT-214 avant que BT-202 à BT-204 soient Done. Le S25,
Bitwig, MCP et le gateway sont absents ou optionnels pendant la preuve NanoDAW
standalone.

Topologie de l'Armada

Lane A - Baseline et intégration, BT-202
- Coordinateur ou sous-agent senior ; effort high ; budget indicatif 12k-18k.
- Propriétaire de la baseline pnpm, de la queue et de l'intégration séquentielle.
- Installer seulement les dépendances déclarées si elles manquent.
- Exécuter test, typecheck, nanodaw:test et smoke:packages.
- Classer chaque échec : code, dépendance, environnement ou live externe.
- Ne jamais lancer Bitwig, le MCP Beat Twin, apps/gateway ou un appel S25.

Lane B - Browser QA et standalone musical loop, BT-203 puis BT-204/BT-205
- Effort high ; budget indicatif 18k-26k.
- Propriétaire exclusif de apps/playground pendant la vague.
- Utiliser les skills frontend-testing-debugging et playwright s'ils sont
  disponibles. Le plugin Browser est prioritaire s'il existe ; sinon Playwright.
- Le flow cible est : NanoDAW charge -> écran utile -> contrôle principal répond
  -> édition/audition -> undo/redo -> save/reload/load.
- Vérifier identité de page, DOM non vide, absence d'overlay, console, une vraie
  interaction, screenshot desktop et mobile.
- Observer les requêtes/processus afin de prouver qu'aucun Bitwig, MCP, gateway
  ou S25 n'est nécessaire.
- Stocker screenshots/traces hors du dépôt, sauf demande explicite contraire.
- Ne modifier le produit qu'après reproduction d'un défaut précis et avec le
  plus petit patch utile.

Lane C - Bitwig dependency health, BT-206 puis BT-207
- Effort high ; budget indicatif 14k-20k.
- Worktree/branche dédiés suggérés : codex/bt-bitwig-process-health.
- Propriétaire exclusif des scripts de preflight/read-only smoke, de leur modèle
  de statut et de leurs tests.
- Détection de processus strictement read-only : ne jamais démarrer, arrêter ou
  signaler Bitwig.
- Linux d'abord ; plateforme non supportée => unknown, jamais faux négatif.
- Distinguer process_not_running, process_running_controller_unknown,
  controller_port_unavailable, controller_ready_mcp_unavailable,
  ready_read_only, ready_write_policy_enabled et unknown.
- Un processus Bitwig présent ne prouve ni controller, ni TCP, ni MCP.
- Un port fermé ne doit plus être présenté comme un générique Connection closed.

Lane D - Architecture/review, lecture seule
- Effort medium ; budget indicatif 6k-10k.
- Auditer BrowserNanoDawPort, ownership de Song state, frontières adapter/gateway
  et compatibilité MCP 57 outils.
- Vérifier que les patches ne créent pas une seconde copie de chanson, ne
  démarrent pas connected mode implicitement et ne relâchent aucune policy write.
- Produire une revue par ticket ; ne pas corriger dans les worktrees des autres.

Règles de coordination
- Une seule lane écrit dans apps/playground.
- Une seule lane écrit dans les scripts/états Bitwig.
- La lane QA navigateur attend la baseline BT-202 verte, mais peut faire un
  scouting read-only des contrôles en parallèle.
- BT-204 ne commence qu'après preuve navigateur BT-203.
- BT-205 est un patch UX borné, pas une refonte du NanoDAW.
- Avant chaque ticket, passe son statut à In progress dans .agents/queue.md.
- Passe à Done uniquement avec les preuves exigées par la roadmap.
- L'offline et le live sont deux gates séparés. N'invente jamais un succès S25,
  Bitwig ou MCP depuis un fixture local.
- N'utilise pas git reset --hard, git checkout -- ou une suppression destructive.
- Ne pousse rien. Demande un go explicite quand une vague locale est prête.

Validation minimale offline
pnpm test
pnpm typecheck
pnpm nanodaw:test
pnpm smoke:packages
git diff --check
git status --short --branch

Validation BT-203/BT-204
- serveur NanoDAW local seulement ;
- Bitwig absent confirmé sans le lancer ;
- aucun processus MCP/gateway lancé par le test ;
- DOM, console, interaction, desktop, mobile ;
- preuve d'édition et de persistance ;
- limites d'audio/autoplay documentées.

Livrable du coordinateur à la fin de la première vague
- tickets Done / In progress / Blocked ;
- commits locaux par lane et ordre d'intégration ;
- résultats exacts des quatre validations offline ;
- rapport QA navigateur avec preuves ;
- statut Bitwig structuré quand l'application est éteinte ;
- risques restants et prochain ticket unique ;
- confirmation que le checkout gateway est resté intact et qu'aucun push n'a
  eu lieu.

Commence maintenant. La roadmap est approuvée : ne repars pas en stratégie
générale. Lance les lanes bornées, garde NanoDAW standalone comme centre de
gravité, valide chaque slice, puis poursuis jusqu'à BT-205 et BT-207 ou jusqu'à
un vrai blocage externe.
```

## Suggested launch

```bash
cd /path/to/beat-twin-nanodaw-standalone
codex
```

Then paste the prompt above.
