# Repo Hygiene

## Базові правила

1. У репозиторій не комітяться runtime/build артефакти:
   - `target/`
   - `target-test-run/`
   - `target-patient-slice/`
   - `dist/`
   - `frontend/dist/`
   - `node_modules/`
   - `frontend/node_modules/`
   - локальні IDE/agent secrets на кшталт `.claude/settings.local.json`

2. Текстові файли мають бути з `LF`, бінарні артефакти маркуються в `.gitattributes`.

3. Кожен merge у `main` має проходити:
   - `cargo fmt --all`
   - `cargo clippy --workspace --all-targets`
   - `cargo test --workspace`
   - `npm --prefix frontend run lint -- --max-warnings 0`
   - `npm --prefix frontend run test`
   - `npm --prefix frontend run build`
   - `python scripts/check_repo_hygiene.py`

## Архітектурні правила

1. Один bounded context не розмазується по паралельних старих flow.
   Поточний приклад: public intake живе в `leads`, а не дублюється окремим `visitor_intake` slice без чіткої межі.

2. Frontend types мають слідувати backend payload, а не дублювати локальні ad-hoc shape.

3. Новий workflow додається тільки разом із:
   - route/API
   - shared type contract
   - UI/consumer
   - test або regression note

## Локальна перевірка

```bash
python scripts/check_repo_hygiene.py
cargo fmt --all
cargo clippy --workspace --all-targets
cargo test --workspace
npm --prefix frontend run lint -- --max-warnings 0
npm --prefix frontend run test
npm --prefix frontend run build
```
