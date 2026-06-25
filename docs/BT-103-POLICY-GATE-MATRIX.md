# BT-103 Policy Gate Matrix

Date: 2026-06-24

Objectif: poser une matrice de policy gate simple et explicite pour Beat Twin, en gardant les lectures sûres par défaut et en bloquant les mutations tant qu un contexte d autorisation n est pas present.

Sources de reference:
- [`Projects/beat-twin/index.js`](/home/lolo/Workspace/lolOS/Projects/beat-twin/index.js)
- [`Projects/beat-twin/docs/BT-101-SESSION-INSPECTOR.md`](/home/lolo/Workspace/lolOS/Projects/beat-twin/docs/BT-101-SESSION-INSPECTOR.md)
- [`docs/LOW_MODEL_CREATIVE_SAFETY_INVENTORY_2026-06-24.md`](/home/lolo/Workspace/lolOS/docs/LOW_MODEL_CREATIVE_SAFETY_INVENTORY_2026-06-24.md)

## Principe

- Les outils `read` sont autorises par defaut.
- Les outils `write` sont bloques par defaut et demandent une autorisation explicite.
- Les outils `risk` sont bloques par defaut et demandent une autorisation explicite plus stricte.
- `bitwig_session_inspect` reste le chemin normal pour obtenir un snapshot lisible sans mutation.
- La policy doit etre lisible, deterministe et simple a brancher dans le wrapper ou la couche d appel.

## Table tool -> policy

| Tool | Policy par defaut | Raison |
| --- | --- | --- |
| `transport_get_tempo` | allow | Lecture pure |
| `transport_get_position` | allow | Lecture pure |
| `transport_playing_status` | allow | Lecture pure |
| `track_bank_get_status` | allow | Lecture pure |
| `scene_list` | allow | Lecture pure |
| `track_selected_get_status` | allow | Lecture pure |
| `device_get_status` | allow | Lecture pure |
| `device_get_remote_controls` | allow | Lecture pure |
| `transport_play` | block | Mutation de transport |
| `transport_stop` | block | Mutation de transport |
| `transport_restart` | block | Mutation de transport |
| `transport_set_tempo` | block | Mutation de transport |
| `transport_set_position` | block | Mutation de transport |
| `track_bank_set_volume` | block | Mutation mixer |
| `track_bank_set_pan` | block | Mutation mixer |
| `track_bank_set_mute` | block | Mutation mixer |
| `track_bank_set_solo` | block | Mutation mixer |
| `track_bank_select` | block | Mutation de contexte de navigation |
| `clip_launch` | block | Mutation de session |
| `clip_stop` | block | Mutation de session |
| `scene_launch` | block | Mutation de session |
| `track_selected_set_volume` | block | Mutation mixer |
| `track_selected_set_pan` | block | Mutation mixer |
| `track_selected_set_mute` | block | Mutation mixer |
| `track_selected_set_solo` | block | Mutation mixer |
| `track_selected_set_arm` | block | Arming/enregistrement |
| `transport_record` | block | Enregistrement direct |
| `clip_record` | block | Enregistrement direct |
| `scene_create` | block | Creation d objet |
| `clip_create` | block | Creation d objet |
| `application_create_instrument_track` | block | Creation d objet |
| `application_create_audio_track` | block | Creation d objet |
| `device_toggle_window` | block | Mutation d affichage/session |
| `device_toggle_expanded` | block | Mutation d affichage/session |
| `device_set_remote_control` | block | Mutation de parametre |
| `device_page_next` | block | Mutation d etat de page |
| `device_page_previous` | block | Mutation d etat de page |
| `bitwig_session_inspect` | allow | Tool read-only compose selon BT-101 |

## Outils read autorises par defaut

- `transport_get_tempo`
- `transport_get_position`
- `transport_playing_status`
- `track_bank_get_status`
- `scene_list`
- `track_selected_get_status`
- `device_get_status`
- `device_get_remote_controls`
- `bitwig_session_inspect`

## Outils write bloques par defaut

- Tout outil qui commence par `transport_` et qui modifie l etat.
- Tout outil `track_bank_set_*`.
- Tout outil `track_selected_set_*`.
- Tout outil `device_toggle_*`, `device_set_*`, `device_page_*`.
- `clip_launch`, `clip_stop`, `scene_launch`.
- `application_create_instrument_track`, `application_create_audio_track`.

## Outils risk bloques par defaut

- `transport_record`
- `clip_record`
- `scene_create`
- `clip_create`
- `track_selected_set_arm`

## Env vars proposees

Ces variables ne sont pas encore implantees; elles servent de contrat pour la squad forte.

| Variable | Valeur proposee | Effet |
| --- | --- | --- |
| `BITWIG_POLICY_MODE` | `readonly` | Bloque toutes les mutations et autorise seulement les lectures |
| `BITWIG_POLICY_ALLOW_WRITE` | `0` ou `1` | Permet d autoriser les outils `write` explicitement |
| `BITWIG_POLICY_ALLOW_RISK` | `0` ou `1` | Permet d autoriser les outils `risk` explicitement |
| `BITWIG_POLICY_REQUIRE_CONFIRMATION` | `1` par defaut | Force une confirmation avant toute mutation |
| `BITWIG_POLICY_CONTEXT` | `read-only`, `session-edit`, `recording`, `arrangement` | Aide a documenter le niveau de risque courant |
| `BITWIG_POLICY_ERROR_STYLE` | `short`, `verbose` | Controle le format des messages d erreur |

## Regles de decision recommandees

- Si `BITWIG_POLICY_MODE=readonly`, refuser tout outil non `allow`.
- Si `BITWIG_POLICY_ALLOW_WRITE=0`, refuser tous les outils `write` meme si le contexte est present.
- Si `BITWIG_POLICY_ALLOW_RISK=0`, refuser tous les outils `risk`.
- Si le contexte n est pas compatible avec l outil demande, refuser avec un message explicite plutot que d essayer de deviner.
- Si le wrapper ne sait pas classer un outil, le traiter comme `block` par defaut.

## Exemples de messages d erreur

### Lecture refusee par contexte

```text
Policy blocked: transport_play is not allowed in readonly mode.
Allowed tools: transport_get_tempo, transport_get_position, transport_playing_status, track_bank_get_status, scene_list, track_selected_get_status, device_get_status, device_get_remote_controls, bitwig_session_inspect.
```

### Mutation refusee par default deny

```text
Policy blocked: clip_create requires explicit write authorization.
Hint: set BITWIG_POLICY_ALLOW_WRITE=1 and confirm the current session context.
```

### Outil a risque refuse sans autorisation supplementaire

```text
Policy blocked: transport_record is a risk-level tool and is disabled by default.
Hint: enable BITWIG_POLICY_ALLOW_RISK=1 only when recording is intentional.
```

### Outil inconnu

```text
Policy blocked: unknown Bitwig tool `foo_bar_baz`.
Hint: update the policy matrix before exposing a new method.
```

## Alignement avec BT-101

- `bitwig_session_inspect` doit rester le point d entree standard pour la lecture composee.
- Le tool inspector ne doit pas appeler de mutation.
- Les erreurs de lecture individuelles doivent remonter comme lecture partielle, pas comme mutation cachee.
- La policy gate ne doit pas empecher l inspecteur de fonctionner si Bitwig est simplement deconnecte.

## Notes d implementation pour la squad forte

- Garder la matrice proche de `index.js` pour qu elle reste facile a maintenir.
- Faire correspondre les categories de policy aux familles d outils deja presentes dans le code.
- Si un nouvel outil est ajoute, il doit recevoir une politique explicite au meme moment.
- Les outils `risk` doivent etre reserves aux workflows ou le contexte, la confirmation et le rollback sont comprenables par l utilisateur.

