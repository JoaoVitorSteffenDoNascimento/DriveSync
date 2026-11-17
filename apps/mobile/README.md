# DriveSync Mobile (Parte 2 — Planejada)

Este diretório reserva a estrutura do aplicativo móvel (**Android** primeiro, com suporte posterior a **iOS**), reutilizando integralmente os tipos, contratos de dispositivos, políticas de remetentes e regra de limite de `4 GiB` definidos em `packages/shared`.

## Arquitetura definida para a Parte 2

1. **Framework:** React Native + Expo (Dev Client com módulos nativos).
2. **Seleção de pasta no Android:** `ACTION_OPEN_DOCUMENT_TREE` (Storage Access Framework) para que o usuário escolha exatamente qual pasta do armazenamento interno ou cartão SD será sincronizada.
3. **Sincronização em segundo plano:** `WorkManager` periódico no Android com restrição opcional de Wi-Fi.
4. **Regras idênticas ao Desktop:**
   - Conexão com **Pasta Pessoal** ou **Drive Master**.
   - Filtro por remetente (`joao@...` permitido, `luiz@...` bloqueado).
   - Preservação local se o arquivo já baixado for apagado no Drive.
   - Bloqueio rígido de uploads acima de **4 GiB**.
   - Registro automático na pasta `.drivesync/devices/<deviceId>.json` para aparecer junto aos PCs Windows/Linux na tela **Dispositivos & Pessoas**.
