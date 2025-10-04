#!/bin/bash

# Script para verificar sistemas centralizados de diários oficiais por estado

echo "🔍 Verificando Sistemas Centralizados por Estado"
echo "================================================"
echo ""

# Estados sem cobertura
STATES=("SP" "BA" "SC" "GO" "MA" "PA" "TO" "AL" "RJ" "MS" "ES" "SE" "AM" "RO" "AC" "AP" "RR" "DF")

for STATE in "${STATES[@]}"; do
  STATE_LOWER=$(echo "$STATE" | tr '[:upper:]' '[:lower:]')
  
  echo "Estado: $STATE"
  echo "---"
  
  # Check diariomunicipal.{uf}.gov.br
  URL1="https://diariomunicipal.${STATE_LOWER}.gov.br/"
  echo -n "  Testando $URL1 ... "
  if curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL1" | grep -q "200\|301\|302"; then
    echo "✅ ENCONTRADO!"
  else
    echo "❌"
  fi
  
  # Check doe.{uf}.gov.br
  URL2="https://doe.${STATE_LOWER}.gov.br/"
  echo -n "  Testando $URL2 ... "
  if curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL2" | grep -q "200\|301\|302"; then
    echo "✅ ENCONTRADO!"
  else
    echo "❌"
  fi
  
  echo ""
done

echo "================================================"
echo "✅ Verificação concluída!"
