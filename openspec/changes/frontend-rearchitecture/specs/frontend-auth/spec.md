# Delta for frontend-auth

## MODIFIED Requirements

### Requirement: Authentication Flow

La interfaz de autenticación SHALL presentar un flujo de pasos: login → MFA (si requerido) o registro → TOTP setup → confirmación.

(Previously: Todo el flujo vivía dentro de App.tsx como JSX inline con useState)

#### Scenario: Unauthenticated user sees login

- GIVEN el usuario no tiene sesión activa
- WHEN navega a `/`
- THEN ve el formulario de login con campos username y password
- AND no ve la interfaz principal

#### Scenario: Login requires MFA

- GIVEN el usuario envía credenciales correctas
- WHEN el backend responde `{mfaRequired: true}`
- THEN la UI cambia al formulario MFA para ingresar código TOTP
- AND el mfaToken queda guardado en el auth store

#### Scenario: Successful login redirects to projects

- GIVEN el usuario completa login exitosamente
- WHEN `user` y `accessToken` están en el store
- THEN navega a `/projects`
- AND ve el TopBar con su nombre

#### Scenario: Registration flow

- GIVEN el usuario elige "Crear cuenta"
- WHEN completa formulario de registro
- THEN backend responde con TOTP URI y confirmToken
- AND la UI muestra el formulario TOTP setup con QR

#### Scenario: Logout clears store

- GIVEN el usuario presiona logout en TopBar
- WHEN `logout()` se ejecuta
- THEN llama a `/auth/logout` DELETE
- AND limpia auth store (user=null, accessToken=null)
- AND navega a `/`

### Requirement: Auth UI Components

El flujo de autenticación SHALL estar compuesto por componentes separados:

(Previously: 419 líneas de JSX mezcladas en un solo archivo App.tsx)

#### Scenario: LoginForm renders independently

- GIVEN LoginForm se monta
- THEN muestra campos username, password y botón "Iniciar sesión"
- AND enlace a registro visible

#### Scenario: MfaForm renders with pending token

- GIVEN el pendingStep es `"mfa"`
- WHEN MfaForm se monta
- THEN muestra campo para código TOTP de 6 dígitos
- AND envía código a `confirmMfa` del auth store

#### Scenario: TopBar shows user info

- GIVEN el usuario está autenticado
- WHEN TopBar se monta
- THEN muestra nombre del usuario y botón logout
- AND enlace a proyectos activo

### Requirement: Auth Route Protection

Las rutas protegidas SHALL redirigir a login si no hay sesión válida.

(Previously: Condición inline en App.tsx que renderiza LoginPage vs Layout)

#### Scenario: Protected path without auth

- GIVEN `authStore.user` es null
- WHEN el usuario navega a `/chat` o `/projects`
- THEN es redirigido a `/` (login)

#### Scenario: Authenticated user stays on page

- GIVEN `authStore.user` tiene valor
- WHEN el usuario navega a `/chat`
- THEN ve la interfaz de chat sin redirección
