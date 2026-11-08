#!/bin/sh
# Бэкап greek.db через backup API SQLite: безопасно, пока сервер работает.
# Крон на ROCK64 (ежедневно в 03:30):
#   30 3 * * * cd /opt/greek && ./deploy/backup.sh >> data/backups/backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."

mkdir -p data/backups
STAMP=$(date +%F)

docker compose exec -T greek node -e "
const Database = require('/app/server/node_modules/better-sqlite3');
const db = new Database('/app/data/greek.db', { readonly: true, fileMustExist: true });
db.backup('/app/data/backups/greek-$STAMP.db').then(() => {
  db.close();
  console.log('backup ok: greek-$STAMP.db');
});
"

find data/backups -name 'greek-*.db' -mtime +30 -delete
