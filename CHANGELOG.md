# Changelog

Todas as alterações relevantes do **DriveSync** são documentadas neste arquivo seguindo os padrões [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e [Semantic Versioning 2.0.0](https://semver.org/lang/pt-BR/).

## [0.4.0] - 2026-11-18

### Adicionado
- **Status de envio e identificação do remetente por arquivo (Desktop e Android)**:
  - Barra de progresso nos cards de pasta mostra a ação atual (`Enviando:` / `Baixando:`) e o remetente responsável (`Enviado por:`).
  - Modal/sheet **Abrir pasta** exibe selos individuais por arquivo (`Enviando agora...`, `Na fila de envio`, `Sincronizado`, `Somente neste aparelho`, `Acima de 4 GB (não sobe)`) acompanhados de `Enviado por: <nome/e-mail>`.
  - Aba **Atividade** passa a exibir `• Enviado por:` nos eventos recentes com autoria registrada.
  - Banco local Android atualizado para versão `2` com colunas `author_email` e `author_name` em `synced_files`.

### Corrigido
- **Layout, diagramas e caixas de download no site institucional (`docs/`)**:
  - Diagramas SVG de largura fixa substituídos por diagramas responsivos em HTML/CSS Grid/Flexbox sem textos cortados e sem barras de rolagem horizontais.
  - Quatro caixas de destaque no hero ampliadas para largura total com tipografia mais legível.
  - Links secundários nos cartões de download (`.msi`, `.deb`, `.rpm`, `.pacman` e `Copiar link para abrir no celular`) reorganizados em barra discreta e simétrica com separadores limpos.

## [0.3.0] - 2026-11-17

### Melhorado
- **Caminhos legíveis no Android e Desktop (`formatStoragePath`)**: URIs SAF internas (`content://com.android.externalstorage.documents/...`) são exibidas de forma clara (ex.: `Memória interna/Teste DriveSync/Teste`) em pílulas limpas nos cards, configurações e opções de pasta.
- **Cabeçalho e grade de botões reorganizados**: eliminação dos 3 botões empilhados no topo (unificado em barra horizontal com `+ Conectar Pasta` e `Atualizar`) e grade 2x3 uniforme nos cards de pastas no Android, com texto resumido e sem poluição visual.
- **Autenticação direta somente com Google Drive**: removidos campos e importadores manuais de chaves (`credentials.json`, `rclone.conf`, `Client ID`/`Secret`) das telas de login Mobile e Desktop, mantendo fallback silencioso no motor Go para execuções locais.

## [0.2.0] - 2026-11-17

### Adicionado
- **Padronização internacional de versionamento (`VERSIONING.md` + `bump-version.mjs`)**: SemVer `MAJOR.MINOR.PATCH` sincronizado entre Desktop, Mobile, motor Go, pacote Shared, PKGBUILD, site oficial e fórmula determinística de `versionCode` para Google Play Store (`0.2.0` -> `versionCode 200`), com validação automática em `npm test`.
- **Exibição da versão oficial na interface**: cabeçalho Mobile e barra lateral Desktop exibem `v0.2.0`; presença do Android lê dinamicamente `BuildConfig.VERSION_NAME`.
- **Descoberta automática de pastas da conta Google** (`Pastas encontradas na sua conta Google` no Mobile e `Pastas da sua conta em outros dispositivos` no Desktop) entre PC ↔ Android ↔ outros PCs logados no mesmo e-mail.
- **Dispositivos conectados na mesma conta Google**: agregação de `.drivesync/devices/*.json` mesmo antes de todas as pastas serem vinculadas localmente.
- **Escolha de pasta local de armazenamento**: seleção da pasta base padrão (`syncRootPath` / SAF no celular), criação automática de subpastas ao conectar descobertas e alteração do caminho/diretório nas **Opções** da pasta.

### Corrigido
- Unificação das chaves de metadados do Google Drive (`ds_folder_kind`, `ds_join_code`, `ds_folder_name`, `ds_sender_email`, `ds_sender_name`) entre o motor Go Desktop e o motor Android Kotlin, mantendo compatibilidade retroativa com propriedades antigas.
- Retorno automático para o app Android no login OAuth Google via loopback (`127.0.0.1:53682`) com resolução DNS em foreground e fallback no token endpoint.

## [0.1.0] - 2026-11-17

### Adicionado
- Lançamento inicial multiplataforma do DriveSync:
  - Motor Desktop Go + interface Electron/React para Windows 10/11 (`.exe`, `.msi`) e Linux (`.AppImage`, `.deb`, `.rpm`, `.pacman`).
  - App Android Capacitor + Kotlin com Storage Access Framework (SAF), WorkManager, boot automático, importação de `credentials.json` / `rclone.conf`, trava rígida de upload `4 GiB` (`4,00 GB`), modo Drive Master e filtro de remetentes.
  - Site de downloads no GitHub Pages e workflows CI/Release.
