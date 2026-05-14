# Ops External Bootstrap

Цей ранбук збирає зовнішні one-time кроки в один контрольований
процес. Код не може підписати DPA замість людини і не може сам
створити перший API token у чужому SaaS, але він може прибрати майже
всю повторювану роботу після цього.

## Автоматизовано в репозиторії

1. `scripts/generate-ops-materials.sh`
   - генерує age keys для DEV / PROD / monitoring / backup master /
     backup recovery;
   - оновлює `infra/terraform/.sops.yaml` публічними recipients;
   - створює `.ops-bootstrap/tailscale-policy.hujson`;
   - створює `.ops-bootstrap/dns-records.txt`;
   - створює `.ops-bootstrap/external-values.env`.

2. `scripts/bootstrap-remote-host.sh`
   - копіює PROD або monitoring age key на сервер;
   - встановлює `/etc/gmed/age.key`;
   - клонує `/opt/gmed/repo`;
   - запускає відповідний deploy script.

3. `scripts/deploy-prod.sh`
   - встановлює backup cron;
   - встановлює Healthchecks.io cron для app `/health`, якщо
     `HEALTHCHECKS_PING_URL` є в `release.env`;
   - idempotently створює/оновлює `gmed_metrics` через
     `scripts/ensure-prod-metrics-user.sh`;
   - рестартить postgres exporter після створення role.

4. `scripts/resolve-ghcr-digests.sh <tag>`
   - дістає digest-pinned GHCR refs без Docker daemon;
   - друкує готові `GMED_BACKEND_IMAGE` / `GMED_FRONTEND_IMAGE` для
     PROD SOPS bundle.

## Що лишається ручним або token-driven

| Area | Автоматизація | Що все ще вручну |
| --- | --- | --- |
| Hetzner projects/API | Terraform керує servers/firewalls/volumes після `HCLOUD_TOKEN`. | Створити projects, прийняти AVV/DPA, створити перший API token. |
| Hetzner Object Storage | Backup script і secrets contract готові. | Створити bucket/credentials і ввімкнути Versioning/Object Lock, якщо доступно. |
| Tailscale | Генерується ACL/policy starter. Deploy scripts автоматично join-ять hosts за auth key. | Застосувати policy і створити tagged auth keys у admin console/API. |
| age/SOPS | Keys і `.sops.yaml` генеруються локально. | Зберегти private keys у vault/offline recovery. |
| DNS | Генерується точний checklist. | Внести A/AAAA у ваш DNS provider або підключити provider-specific CLI/API. |
| SMTP | Alertmanager config готовий. | Створити SMTP credentials у Resend/Mailgun/Postmark/etc. |
| Healthchecks.io | Deploy scripts ставлять cron, якщо ping URLs є в SOPS. | Створити checks/UUID або підключити Healthchecks API token. |
| GHCR | Digest refs резолвляться скриптом. | Запустити перший release tag/push, щоб images існували. |

## Рекомендований порядок

```bash
scripts/generate-ops-materials.sh
```

Збережи private keys з `~/.config/sops/age`:

- `gmed-dev.key` -> DEV vault;
- `gmed-prod.key` -> PROD vault;
- `gmed-monitoring.key` -> monitoring vault;
- `gmed-backup-master.key` -> PROD backup vault;
- `gmed-backup-recovery.key` -> offline recovery.

Потім:

1. Hetzner: створи `gmed-dev`, `gmed-prod`, monitoring project/token
   strategy, AVV/DPA, Object Storage bucket + credentials.
2. Tailscale: застосуй `.ops-bootstrap/tailscale-policy.hujson`,
   створи auth keys для `tag:gmed-dev`, `tag:gmed-prod`,
   `tag:gmed-monitoring`.
3. Заповни SOPS bundles значеннями з `.ops-bootstrap/external-values.env`
   і зашифруй їх через `sops -e -i`.
4. Terraform apply для DEV / PROD / monitoring.
5. DNS A/AAAA після Terraform outputs.
6. Remote bootstrap:

```bash
scripts/bootstrap-remote-host.sh prod console.gmed-health.com ~/.config/sops/age/gmed-prod.key
scripts/bootstrap-remote-host.sh monitoring <monitoring-ip> ~/.config/sops/age/gmed-monitoring.key
```

7. Після першого release tag:

```bash
scripts/resolve-ghcr-digests.sh vYYYY.MM.DD
```

Скопіюй output у PROD `secrets.sops.yaml`, re-encrypt, commit, deploy.
