# Padrão de Versionamento e Releases — DriveSync

O **DriveSync** segue normas internacionais amplamente adotadas no mercado de software e pela **Google Play Store** para garantir rastreabilidade entre código, instaladores Desktop (Windows/Linux) e APK Android.

---

## 1. Semantic Versioning 2.0.0 (`vMAJOR.MINOR.PATCH`)

Todas as versões e tags seguem estritamente o formato `MAJOR.MINOR.PATCH` (ex.: `0.2.0`) e tags Git com prefixo `v` (ex.: `v0.2.0`):

- **MAJOR (`X.0.0`)**: mudanças incompatíveis de protocolo, banco local ou arquitetura principal.
- **MINOR (`0.X.0`)**: novos recursos mantendo compatibilidade (ex.: `0.2.0` com descoberta automática de pastas da conta, lista de dispositivos conectados e escolha de pasta de armazenamento).
- **PATCH (`0.1.X`)**: apenas correções de bugs e ajustes internos sem quebra de contrato.

> **Regra de imutabilidade:** nunca sobrescreva uma tag já publicada em produção (`v0.1.0`, `v0.2.0`, etc.). Cada nova atualização ou correção recebe o próximo número de versão antes de gerar os binários.

---

## 2. Padrão Google Play Store / Android (`versionName` e `versionCode`)

A Google Play Store e o sistema Android exigem dois identificadores independentes no `app/build.gradle`:

- **`versionName`**: string SemVer visível ao usuário (`"MAJOR.MINOR.PATCH"`, ex.: `"0.2.0"`).
- **`versionCode`**: número inteiro estritamente crescente a cada novo APK/AAB enviado, calculado deterministicamente pela fórmula:

```text
versionCode = MAJOR * 10000 + MINOR * 100 + PATCH
```

Exemplos:
- `0.1.0` -> `versionCode = 100` (legado `1` na entrega inicial)
- `0.2.0` -> `versionCode = 200`
- `0.2.1` -> `versionCode = 201`
- `1.0.0` -> `versionCode = 10000`
- `1.2.3` -> `versionCode = 10203`

Isso evita conflitos de downgrade no Android/Play Store e permite até 99 versões PATCH e 99 versões MINOR por MAJOR.

---

## 3. Nomenclatura de Tags, Artefatos e Mensagens de Commit

### Tags e Releases no GitHub
- **Tag Git**: `vX.Y.Z` (dispara automaticamente o workflow `Release Multiplataforma`).
- **Título da Release**: `DriveSync vX.Y.Z`.

### Nomenclatura de Instaladores e APK (links perenes `releases/latest/download/`)
Os arquivos anexados à release preservam nomes padronizados por plataforma e arquitetura para manter os links de download diretos sempre funcionais no site oficial e no compartilhamento dentro do app, enquanto a versão fica gravada nos metadados do instalador, na tag Git e exibida na interface (`vX.Y.Z`):

| Plataforma | Arquivo |
| :--- | :--- |
| Android 7+ | `DriveSync-Android.apk` |
| Windows x64 (Instalador) | `DriveSync-Setup-Windows-x64.exe` |
| Windows x64 (MSI) | `DriveSync-Windows-x64.msi` |
| Linux x64 Universal | `DriveSync-Linux-x64.AppImage` |
| Linux Debian / Ubuntu | `DriveSync-Linux-x64.deb` |
| Linux Fedora / RHEL | `DriveSync-Linux-x64.rpm` |
| Linux Arch / Manjaro | `DriveSync-Linux-x64.pacman` |

### Conventional Commits
Padronizamos os commits no padrão internacional *Conventional Commits*:
- `feat:` — nova funcionalidade (normalmente gera incremento `minor`)
- `fix:` — correção de bug (normalmente gera incremento `patch`)
- `chore(release):` — atualização de versão, changelog e criação da tag `vX.Y.Z`
- `docs:` / `refactor:` / `test:` — documentação, refatoração e testes

---

## 4. Como atualizar a versão em todo o projeto

Nunca edite apenas um arquivo manualmente. Use sempre os scripts centrais da raiz:

```bash
# Incrementar automaticamente (patch | minor | major | X.Y.Z)
npm run version:bump -- minor

# Verificar se todos os arquivos (NPM, Shared, Go, Android Gradle, PKGBUILD e Docs) batem
npm run version:check
```

Ao fazer push com a tag (`git push origin main --tags`), o workflow `.github/workflows/release.yml` compila Windows, Linux e Android APK e publica a nova release `vX.Y.Z`.
