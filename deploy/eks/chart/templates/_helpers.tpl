{{- define "trippilot.labels" -}}
app.kubernetes.io/name: trippilot
app.kubernetes.io/instance: {{ .Release.Name | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service | quote }}
app.kubernetes.io/part-of: trippilot
trippilot.io/environment: {{ .Values.environment | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}

{{- define "trippilot.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name | quote }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "trippilot.podSpec" -}}
automountServiceAccountToken: false
# Schedule generation can hold requests for 610s; allow application and NLB draining.
terminationGracePeriodSeconds: {{ if eq .component "embedding" }}45{{ else }}660{{ end }}
nodeSelector:
  kubernetes.io/os: linux
  kubernetes.io/arch: amd64
securityContext:
  runAsNonRoot: true
  runAsUser: {{ .uid }}
  runAsGroup: {{ .uid }}
  fsGroup: {{ .uid }}
  seccompProfile:
    type: RuntimeDefault
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "trippilot.selector" . | nindent 8 }}
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "trippilot.selector" . | nindent 8 }}
{{- end -}}

{{- define "trippilot.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsNonRoot: true
capabilities:
  drop: [ALL]
{{- end -}}

{{- define "trippilot.secretEnv" -}}
- name: {{ .env }}
  valueFrom:
    secretKeyRef:
      name: {{ .secret }}
      key: {{ default .env .key }}
      optional: {{ default false .optional }}
{{- end -}}

{{- define "trippilot.image" -}}
{{- $image := index .root.Values.images .component -}}
{{- printf "%s:%s" (required (printf "images.%s.repository is required" .component) $image.repository) (required (printf "images.%s.tag is required" .component) $image.tag) | quote -}}
{{- end -}}
