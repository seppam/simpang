{{/* Shared template helpers for the simpang chart. */}}

{{- define "simpang.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "simpang.fullname" -}}
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

{{- define "simpang.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "simpang.selectorLabels" -}}
app.kubernetes.io/name: {{ include "simpang.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "simpang.labels" -}}
helm.sh/chart: {{ include "simpang.chart" . }}
{{ include "simpang.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "simpang.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}

{{/* Name of the Secret the pods read: the existing one, or the chart-managed one. */}}
{{- define "simpang.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- printf "%s-secret" (include "simpang.fullname" .) }}
{{- end }}
{{- end }}

{{- define "simpang.configName" -}}
{{- printf "%s-config" (include "simpang.fullname" .) }}
{{- end }}

{{- define "simpang.postgresName" -}}
{{- printf "%s-postgres" (include "simpang.fullname" .) }}
{{- end }}

{{/* DATABASE_URL, read from the Secret. Rendered at the top level of an env list. */}}
{{- define "simpang.databaseUrlEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "simpang.secretName" . }}
      key: DATABASE_URL
{{- end }}

{{- define "simpang.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "simpang.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop:
    - ALL
{{- end }}
