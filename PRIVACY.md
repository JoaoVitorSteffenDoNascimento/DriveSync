# Política de Privacidade — DriveSync

**Última atualização:** 17 de novembro de 2026

O **DriveSync** é um aplicativo de código aberto executado localmente no dispositivo do usuário para sincronizar pastas escolhidas pelo próprio usuário com o Google Drive.

## 1. Dados acessados via Google Drive API
Ao autorizar o acesso com sua Conta Google, o DriveSync solicita acesso ao escopo da Google Drive API (`https://www.googleapis.com/auth/drive`) exclusivamente para:
- Listar e exibir suas pastas e pastas compartilhadas no seletor de pastas do aplicativo;
- Baixar e enviar arquivos das pastas que você conectar explicitamente;
- Ler metadados de autor/remetente dos arquivos (`owners`, `lastModifyingUser`, `sharingUser`) para aplicar os filtros de remetentes configurados por você no modo **Drive Master**;
- Gravar e ler registros simples de dispositivos conectados e códigos de convite na pasta sincronizada (`.drivesync/` e propriedades da pasta).

## 2. Armazenamento e segurança
- **Sem servidores intermediários:** o DriveSync comunica-se diretamente do seu computador com a API oficial do Google Drive. Nenhum arquivo, metadado ou token é enviado para servidores de terceiros.
- **Tokens locais:** as credenciais OAuth da sua sessão ficam armazenadas apenas localmente no seu dispositivo (`drivesync.db` criptografado com chave local `0600`).
- **Exclusão e proteção:** as regras de exclusão e bloqueio de arquivos maiores que 4 GiB são processadas exclusivamente no seu dispositivo.

## 3. Revogação de acesso e contato
Você pode desconectar sua conta a qualquer momento dentro do próprio aplicativo (*Configurações → Desconectar*) ou revogar a permissão em [Permissões da Conta Google](https://myaccount.google.com/permissions).

Dúvidas ou solicitações de suporte: `joaovitorsteffendonascimento@gmail.com`.

---

# Privacy Policy — DriveSync

**DriveSync** runs locally on the user's device and communicates directly with the official Google Drive API (`https://www.googleapis.com/auth/drive`) solely to synchronize user-selected folders, apply user-configured sender filters in Master folders, and coordinate connected devices. No files, credentials, or telemetry are sent to third-party servers. OAuth tokens are stored encrypted locally on the user's device and may be revoked at any time via the app or Google Account Permissions. Contact: `joaovitorsteffendonascimento@gmail.com`.
