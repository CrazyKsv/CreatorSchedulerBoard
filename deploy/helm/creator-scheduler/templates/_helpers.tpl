{{/*
Expand the name of the chart.
*/}}
{{- define "creator-scheduler.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncated at 63 chars to respect DNS label limits.
*/}}
{{- define "creator-scheduler.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label (name-version).
*/}}
{{- define "creator-scheduler.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels shared by every resource in the release.
*/}}
{{- define "creator-scheduler.labels" -}}
helm.sh/chart: {{ include "creator-scheduler.chart" . }}
{{ include "creator-scheduler.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels shared by every resource. Component is overridden by
callers that need to distinguish frontend vs. backend.
*/}}
{{- define "creator-scheduler.selectorLabels" -}}
app.kubernetes.io/name: {{ include "creator-scheduler.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component-scoped resource name: e.g. "myrelease-creator-scheduler-backend".
Usage: {{ include "creator-scheduler.componentName" (dict "ctx" . "component" "backend") }}
*/}}
{{- define "creator-scheduler.componentName" -}}
{{- printf "%s-%s" (include "creator-scheduler.fullname" .ctx) .component | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Component selector labels — used by Deployment.spec.selector and Service.spec.selector.
Usage: {{ include "creator-scheduler.componentSelectorLabels" (dict "ctx" . "component" "backend") }}
*/}}
{{- define "creator-scheduler.componentSelectorLabels" -}}
{{ include "creator-scheduler.selectorLabels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Component-scoped full label set (adds Helm chart metadata).
*/}}
{{- define "creator-scheduler.componentLabels" -}}
{{ include "creator-scheduler.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Resolve the effective CORS origins string. If the user did not override
backend.env.corsOrigins, fall back to `http://{{ .Values.ingress.host }}`
so the middleware allows the ingress host.
*/}}
{{- define "creator-scheduler.corsOrigins" -}}
{{- if .Values.backend.env.corsOrigins -}}
{{- .Values.backend.env.corsOrigins -}}
{{- else -}}
{{- printf "http://%s" .Values.ingress.host -}}
{{- end -}}
{{- end }}

{{/*
Resolve or generate the JWT SECRET_KEY.

Priority:
  1. Explicit `.Values.backend.secretKey` if provided (useful in CI).
  2. Existing in-cluster Secret value (preserves key across upgrades).
  3. Random 48-char alphanumeric generated on first install.

Returned as a base64-encoded string (Secret.data format).
*/}}
{{- define "creator-scheduler.secretKey" -}}
{{- $secretName := include "creator-scheduler.componentName" (dict "ctx" . "component" "backend") -}}
{{- if .Values.backend.secretKey -}}
{{- .Values.backend.secretKey | b64enc -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $secretName -}}
{{- if and $existing (index $existing.data "SECRET_KEY") -}}
{{- index $existing.data "SECRET_KEY" -}}
{{- else -}}
{{- randAlphaNum 48 | b64enc -}}
{{- end -}}
{{- end -}}
{{- end }}
