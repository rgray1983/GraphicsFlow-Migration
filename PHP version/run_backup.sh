#!/bin/zsh

curl -s -X POST "http://localhost/graphics/admin.php?auto_backup=1&key=9inchnails" \
  -d "create_backup=1"