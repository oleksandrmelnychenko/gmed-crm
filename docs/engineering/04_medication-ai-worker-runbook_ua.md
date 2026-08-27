# Runbook: Medication Evidence AI worker

Цей runbook покриває rollout fencing-міграції, спостереження за чергою,
безпечний rollback та інциденти worker lease. Локальний детермінований evidence
package залишається доступним незалежно від стану зовнішнього AI.

## Незмінні правила безпеки

- У ticket, alert annotation, чат інциденту й operational log не копіювати
  ПІБ, medication/diagnosis text, prompt/output або patient, review, analysis,
  actor, lease чи provider-response ID.
- Не виправляти `status`, `lease_until`, `lease_token` або lifecycle events
  ручним SQL. Для штатного повтору використовувати CEO retry action після
  переходу job у `failed`.
- Kill switch: `GMED_MEDICATION_AI_ENABLED=false` плюс restart backend.
  Локальний evidence review при цьому не втрачається.
- Для кожного середовища потрібен окремий
  `GMED_MEDICATION_AI_GOVERNANCE_REVIEW_ID` з `[A-Za-z0-9._-]` довжиною до 96.
  ID посилається на схвалений governance artifact, але не містить URL, ПІБ,
  email чи текст review і не копіюється в operational logs. Значення
  `legacy-unrecorded` зарезервоване migration і не може бути approval ID.
- Не робити down-migration fencing schema під час інциденту.

## Lease та рішення щодо heartbeat

Поточний provider HTTP timeout — 45 секунд, worker lease — 75 секунд. Унікальний
token кожного claim та перевірка `lease_until > clock_timestamp()` не дають
простроченому worker записати `ready`/`failed`, event, metric чи notification.

Heartbeat зараз не потрібен: нормальний зовнішній виклик має 30 секунд запасу
до lease boundary, а завислий або призупинений процес безпечніше fence-нути й
повторити. Heartbeat додасть окремий write loop і нові failure/race paths.

Переглядати це рішення лише за вимірюваними доказами:

- `gmed_medication_ai_fenced_attempts_total` росте без backend restart,
  deployment pause або PostgreSQL incident;
- p99 `gmed_medication_ai_provider_duration_seconds` стабільно перевищує
  35 секунд і зменшує практичний запас до provider timeout;
- approved provider contract вимагає timeout понад 45 секунд.

Спочатку слід усунути provider/DB latency. Якщо heartbeat усе ж стане потрібен,
його продовження lease також мусить бути fenced через `id + processing +
lease_token`; heartbeat не має продовжувати вже прострочений lease.

## Rollout migration `20260827161000`

1. Переконатися, що AI лишається вимкненим у PROD, vendor/GDPR approval
   зафіксований окремо, а його environment-specific bounded ID налаштований у
   `GMED_MEDICATION_AI_GOVERNANCE_REVIEW_ID`.
2. Перевірити alert delivery та наявність метрик backend.
   Перед migration перевірити aggregate event-head invariant:

   ```sql
   SELECT count(*) AS invalid_event_heads
   FROM medication_ai_analyses AS analysis
   LEFT JOIN LATERAL (
       SELECT event.to_status
       FROM medication_ai_analysis_events AS event
       WHERE event.analysis_id = analysis.id
       ORDER BY event.created_at DESC, event.id DESC
       LIMIT 1
   ) AS head ON TRUE
   WHERE head.to_status IS DISTINCT FROM analysis.status;
   ```

   Очікуване значення — `0`; інакше migration має бути зупинена й lifecycle
   inconsistency досліджена без копіювання IDs у загальні logs/tickets.
3. Зупинити всі старі backend API та workers. Migration `20260827161000`
   блокує pre-fencing worker, а `20260827163000` термінально fail-close-ить усі
   наявні jobs без governance provenance й DB trigger не дозволяє старому
   retry повернути їх у чергу. Проте fencing-aware, але governance-unaware
   worker усе ще міг би claim-ити вже новий governed job. Крім того, API без
   migration `20260827164000` не зберігає другий idempotency key після
   semantic dedup, тому після governance rotation такий key може повернути
   інший analysis. Через це mixed-version rollout не підтримується: old
   API/worker processes мають бути повністю зупинені до migration і не
   повертатися, доки новий backend не розгорнуто на всіх instances.
4. Застосувати міграції у звичайному порядку. Fencing migration
   `20260827161000`:
   - додає `lease_token`;
   - повертає поточні `processing` jobs у `requested`;
   - повертає перервану deployment-ом спробу;
   - додає state та lifecycle-event guards.
   Наступна additive migration `20260827162000` додає partial health index за
   bounded `reason_code + created_at`; вона не змінює lifecycle data.
   Migration `20260827163000`:
   - додає bounded immutable `governance_review_id` без default для нових rows;
   - позначає historical rows sentinel-значенням `legacy-unrecorded`;
   - атомарно переводить legacy `requested`/`processing` jobs у `failed` через
     валідні state/event transitions з `provider_configuration_changed`;
   - розширює deduplication uniqueness governance review ID.
   Migration `20260827164000` додає write-once idempotency mapping: primary key
   кожного analysis backfill/capture-иться автоматично, а successful semantic
   dedup назавжди зв'язує другий key із тим самим analysis навіть після
   governance rotation/revert. Keys є operational secrets, не потрапляють у
   API, logs або Art. 15 export і видаляються cascade разом з patient-owned
   analysis. Owner alias є namespace актора, який подав key, і навмисно може
   відрізнятися від creator analysis після authorized cross-actor semantic
   dedup. DB guards забороняють UPDATE/reassignment і standalone DELETE, але
   дозволяють privacy cascade під час erasure analysis або alias owner.
   Migration коротко блокує writes до `medication_ai_analyses`, щоб backfill і
   встановлення capture trigger не мали проміжку.

   Durable guarantee починається з моменту migration: primary keys historical
   analyses backfill-яться, але secondary key, який старий binary уже повернув
   через semantic dedup, раніше ніде не записувався і не може бути відновлений.
   Його перший replay після rollout прив'яжеться до analysis, відповідного
   чинному governance review. Не змінювати governance approval під час cutover
   і не використовувати mixed binaries; якщо потрібна безумовна історична
   відповідність такого key, клієнт має створити нову явно відстежувану
   operation після rollout.

   Keys зберігаються plaintext у restricted operational DB/backups (primary key
   уже існував у `medication_ai_analyses`, mapping додає alias copies). Вони не
   повинні містити PHI. Row triggers блокують UPDATE та standalone DELETE, але
   privileged DDL/TRUNCATE може їх обійти; production hardening потребує
   окремого runtime role без DDL/TRUNCATE та контрольованого migration role.
   `ALTER TABLE` та перебудова unique index беруть сильні locks і виконуються в
   одній transaction: заздалегідь оцінити розмір таблиць та виділити maintenance
   window. При будь-якій помилці schema/state/events мають відкотитися разом.
5. Розгорнути новий backend до ввімкнення AI.
6. Авторизованим IT-admin перевірити `/api/v1/admin/health` і агрегатні SQL нижче.
   Якщо migration закрила legacy jobs, `failed_last_24h` та operational
   `attention` очікувані до 24 годин; звірити їх із migration window і
   `provider_configuration_changed`, не шукаючи patient/job IDs у logs.
7. Зробити synthetic DEV request, перевірити `requested → processing → ready`
   та відсутність fenced/recovery сигналів.
8. Лише після цього ввімкнути PROD gate та restart backend. Provider не повинен
   переходити в `ready`, якщо governance review ID відсутній або невалідний;
   browser capability payload не повинен містити саме значення ID.

Schema інваріант після rollout:

```sql
SELECT count(*) AS invalid_lease_rows
FROM medication_ai_analyses
WHERE (status = 'processing' AND (lease_until IS NULL OR lease_token IS NULL))
   OR (status <> 'processing' AND (lease_until IS NOT NULL OR lease_token IS NOT NULL));
```

Очікуване значення — `0`. Запит не повертає жодних ідентифікаторів.

Додатково після governance migration:

```sql
SELECT count(*) AS legacy_nonterminal_jobs
FROM medication_ai_analyses
WHERE governance_review_id = 'legacy-unrecorded'
  AND status IN ('requested', 'processing');
```

Очікуване значення — `0`. Legacy failure не можна manual-retry під новим
approval. Після перевірки актуальності evidence потрібно створити новий job з
новим idempotency key; governance-aware uniqueness дозволяє окремий analysis.

## Нормальні сигнали

- `gmed_medication_ai_jobs_total{outcome,reason}` — bounded lifecycle outcomes.
- `gmed_medication_ai_provider_duration_seconds{outcome}` — тривалість
  зовнішнього attempt незалежно від того, чи був результат прийнятий.
- `gmed_medication_ai_fenced_attempts_total{attempt_outcome}` — attempt
  завершився після втрати/завершення lease та був безпечно відкинутий.
- System Health backend payload (`medication_ai.queue`):
  - `stale_processing`;
  - `lease_recovered_last_24h` / `last_lease_recovery_at`;
  - `lease_exhausted_last_24h` / `last_lease_exhausted_at`;
  - `oldest_requested_seconds` (вік найстарішого вже eligible job від його
    `available_at`), `failed_last_24h`.

PHI-free історію recovery можна перевірити так:

```sql
SELECT reason_code, count(*) AS transitions, max(created_at) AS last_at
FROM medication_ai_analysis_events
WHERE reason_code IN ('worker_lease_expired', 'worker_lease_exhausted')
  AND created_at >= now() - interval '24 hours'
GROUP BY reason_code
ORDER BY reason_code;
```

## Реакція на інцидент

### Fenced attempt або lease recovery

1. Не шукати job за patient/analysis ID у загальних логах.
2. Зіставити час сигналу з backend restart/deploy, container pause,
   PostgreSQL latency та provider duration.
3. Перевірити агрегатні queue/recovery поля System Health.
4. Якщо сигнал одиничний, queue рухається, а `stale_processing = 0`, fencing
   відпрацював штатно; зафіксувати лише технічну причину.
5. Якщо сигнали повторюються або queue age росте, вимкнути AI gate, restart
   backend і залишити детермінований evidence workflow доступним.

### Exhausted lease або terminal failure

1. Вимкнути нові зовнішні виклики при повторенні помилки.
2. Перевірити bounded `reason` у metric/alert та provider/DB availability.
3. Не виконувати ручний state transition. Після усунення причини CEO може
   запустити штатний manual retry для `failed` job.
4. Якщо причина safety/schema validation, не retry-ити до окремого code/data
   review.

## Rollback

1. Встановити `GMED_MEDICATION_AI_ENABLED=false` і restart усіх backend
   instances.
2. Переконатися, що provider state у System Health — `disabled`, а queue не
   отримує нових claims.
3. Не відкочувати fencing migration: вона additive і захищає вже створені jobs.
4. Старий binary можна тимчасово повернути лише з AI gate вимкненим; його worker
   не підтримує tokenized claims.
5. Для відновлення AI розгорнути виправлений fencing-aware backend і повторити
   rollout checks вище.
