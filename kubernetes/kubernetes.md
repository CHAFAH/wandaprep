# Kubernetes — WANDAPREP Training Guide

---

## 1. What is Kubernetes?

Kubernetes (K8s) is an open-source container orchestration platform originally developed by Google and donated to the CNCF. It automates the deployment, scaling, and management of containerized applications across a cluster of machines.

Instead of manually running containers on individual servers, you declare the **desired state** — how many copies should run, what resources they need, how they are exposed — and Kubernetes continuously works to maintain that state.

Key capabilities:
- **Self-healing** — restarts failed containers, replaces pods on unhealthy nodes
- **Horizontal scaling** — scale up or down with one command or automatically
- **Service discovery** — built-in DNS so pods find each other by name
- **Rolling updates and rollbacks** — deploy new versions with zero downtime
- **Configuration management** — decouple config and secrets from container images

---

## 2. Kubernetes Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         CONTROL PLANE                            │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  kube-apiserver │  │kube-scheduler│  │kube-controller-mgr │  │
│  └────────┬────────┘  └──────────────┘  └────────────────────┘  │
│           │                                                       │
│  ┌────────▼────────┐  ┌──────────────────────┐                  │
│  │      etcd       │  │ cloud-controller-mgr  │                  │
│  └─────────────────┘  └──────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
  ┌────────▼──────┐   ┌────────▼──────┐   ┌────────▼──────┐
  │  Worker Node  │   │  Worker Node  │   │  Worker Node  │
  │  kubelet      │   │  kubelet      │   │  kubelet      │
  │  kube-proxy   │   │  kube-proxy   │   │  kube-proxy   │
  │  containerd   │   │  containerd   │   │  containerd   │
  │  [Pod][Pod]   │   │  [Pod][Pod]   │   │  [Pod][Pod]   │
  └───────────────┘   └───────────────┘   └───────────────┘
```

| Component | Role |
|---|---|
| **kube-apiserver** | Front door of the cluster. Every request from kubectl, controllers, or nodes goes through it. Validates and persists state to etcd. |
| **etcd** | Distributed key-value store. Holds the entire cluster state — every object, config, and status. Single source of truth. |
| **kube-scheduler** | Watches for pods with no assigned node and picks the best node based on resources, affinity, taints, and tolerations. |
| **kube-controller-manager** | Runs all built-in controllers. Each one reconciles actual state toward desired state (e.g. ReplicaSet controller keeps the right number of pods running). |
| **cloud-controller-manager** | Integrates with AWS. Manages Load Balancers, node lifecycle, and routes. |
| **kubelet** | Agent on every node. Receives pod specs and ensures containers are running and healthy. |
| **kube-proxy** | Maintains network rules on each node for pod-to-pod and external traffic. |
| **Container Runtime** | Runs containers (containerd). The kubelet talks to it via CRI. |

---

## 3. Provision the EKS Cluster with Terraform

The `terraform/` directory provisions:
- A production-grade VPC across 3 AZs with one NAT Gateway per AZ and VPC Flow Logs
- EKS 1.31 cluster with managed node groups (`t3.medium`)
- Core addons: `coredns`, `kube-proxy`, `vpc-cni`, `aws-ebs-csi-driver` — all `most_recent`
- IRSA roles for EBS CSI Driver and AWS Load Balancer Controller
- AWS Load Balancer Controller via Helm (2 replicas)
- Default `gp3` encrypted StorageClass

```bash
cd terraform/
terraform init
terraform plan
terraform apply        # ~15 minutes
```

```bash
aws eks update-kubeconfig --region us-east-1 --name eks-wandaprep-prod
kubectl get nodes
```

---

## 4. Verify the AWS Load Balancer Controller

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller
kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller --tail=20
kubectl get serviceaccount aws-load-balancer-controller -n kube-system -o jsonpath='{.metadata.annotations}'
```

Expected annotation:
```json
{"eks.amazonaws.com/role-arn":"arn:aws:iam::<account-id>:role/eks-wandaprep-prod-aws-lbc"}
```

---

## 5. The WANDAPREP Application

The app is a Node.js/Express server (`chafah/wandaprep:v1.0`) that:
- Serves a full-page HTML response showing runtime config values
- Reads `APP_COLOR`, `APP_ENV`, `APP_MESSAGE`, `SECRET_KEY` from environment variables
- Falls back to safe defaults when no env vars are set (`APP_COLOR=red`, `SECRET_KEY=not-set`)
- Prints a startup banner to stdout the moment it is ready

### Startup log (what you see with `kubectl logs`)

```
================================================================
  ✅  IF YOU SEE THIS LOG, THE WANDAPREP APP IS RUNNING!
================================================================
  Timestamp   : 2024-xx-xxTxx:xx:xx.xxxZ
  Port        : 8080
  Environment : development
  Color       : red
  Message     : Hello from WANDAPREP!
  Secret Key  : not-set
----------------------------------------------------------------
  These values come from:
    APP_COLOR   → ConfigMap  (wandaprep-config)
    APP_ENV     → ConfigMap  (wandaprep-config)
    APP_MESSAGE → ConfigMap  (wandaprep-config)
    SECRET_KEY  → Secret     (wandaprep-secret)
================================================================
```

When no env vars are injected the app runs with defaults. This is intentional — it shows exactly what changes when ConfigMaps and Secrets are introduced.

---

## 6. Workload Objects

```
Pod  →  ReplicaSet  →  Deployment  →  DaemonSet
```

---

### 6.1 Pod

A Pod is the smallest deployable unit in Kubernetes. It wraps one or more containers that share the same network namespace and storage volumes. Containers inside the same pod communicate over `localhost`.

**Use cases:**
- Running a single application container
- Tightly coupled helper containers (init containers, sidecars)
- One-off debugging or testing

**What a pod is NOT:** self-healing. If it crashes or is deleted, it is gone. That is why we use ReplicaSets and Deployments.

We start with the simplest possible pod — just the image and port. No env vars. The app uses its built-in defaults.

**Manifest — `kubernetes/POD/pod.yaml`**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: wandaprep-app
  labels:
    app: wandaprep
spec:
  containers:
  - name: wandaprep-app-container
    image: chafah/wandaprep:v1.0
    ports:
    - containerPort: 8080
```

```bash
kubectl apply -f kubernetes/POD/pod.yaml
kubectl get pod wandaprep-app -w
```

```
NAME             READY   STATUS              RESTARTS   AGE
wandaprep-app    0/1     ContainerCreating   0          2s
wandaprep-app    1/1     Running             0          7s
```

**Get the logs — confirm the app is running:**

```bash
kubectl logs wandaprep-app
```

You will see the startup banner with defaults (`color=red`, `secret=not-set`).

```bash
kubectl describe pod wandaprep-app    # node, events, image, status
kubectl logs wandaprep-app -f         # follow in real time
kubectl exec -it wandaprep-app -- sh  # shell into the container
kubectl delete pod wandaprep-app
```

---

### 6.2 ReplicaSet

A ReplicaSet ensures a specified number of identical pod replicas are running at all times. If a pod crashes or is deleted, the controller immediately creates a replacement.

**Use cases:**
- Guarantee N copies of a pod are always running
- Spread load across multiple pod instances
- Foundation that Deployments build on

> In practice you manage ReplicaSets indirectly through Deployments. Understanding them directly is important for troubleshooting.

**Manifest — `kubernetes/REPLICASET/replicaset.yaml`**

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: wandaprep-replicaset
spec:
  replicas: 3
  selector:
    matchLabels:
      app: wandaprep
  template:
    metadata:
      labels:
        app: wandaprep
    spec:
      containers:
      - name: wandaprep-container
        image: chafah/wandaprep:v1.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "250m"
            memory: "256Mi"
```

```bash
kubectl apply -f kubernetes/REPLICASET/replicaset.yaml
kubectl get replicaset wandaprep-replicaset
kubectl get pods -l app=wandaprep
kubectl logs -l app=wandaprep --prefix=true   # startup banner from all 3 pods
```

**Test self-healing:**

```bash
kubectl delete pod <pod-name>
kubectl get pods -l app=wandaprep -w          # watch it come back immediately
```

```bash
kubectl delete replicaset wandaprep-replicaset
```

> **Key takeaway:** A ReplicaSet gives you resilience but no rolling updates. That is what Deployments add.

---

### 6.3 Deployment

A Deployment is the standard way to run stateless applications. It owns a ReplicaSet and adds rolling update and rollback capabilities. When you change the image or config, it creates a new ReplicaSet and gradually shifts pods to it while scaling down the old one — zero downtime.

**Use cases:**
- Stateless web applications and APIs (the most common workload in Kubernetes)
- Any app that needs rolling updates, rollbacks, or scaling
- Blue/green and canary deployments

**Manifest — `kubernetes/DEPLOYMENT/deploy.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wandaprep-deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: wandaprep
  template:
    metadata:
      labels:
        app: wandaprep
    spec:
      containers:
      - name: wandaprep-container
        image: chafah/wandaprep:v1.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "250m"
            memory: "256Mi"
```

```bash
kubectl apply -f kubernetes/DEPLOYMENT/deploy.yaml
kubectl get deployment wandaprep-deployment
kubectl get replicaset
kubectl get pods -l app=wandaprep
kubectl logs -l app=wandaprep --prefix=true
```

**Rolling update:**

```bash
kubectl set image deployment/wandaprep-deployment wandaprep-container=chafah/wandaprep:v2.0
kubectl rollout status deployment/wandaprep-deployment
```

**Rollback:**

```bash
kubectl rollout undo deployment/wandaprep-deployment
kubectl rollout history deployment/wandaprep-deployment
```

**Scale:**

```bash
kubectl scale deployment wandaprep-deployment --replicas=5
```

---

### 6.4 DaemonSet

A DaemonSet ensures that **one pod runs on every node** in the cluster (or a subset of nodes). When a new node joins the cluster, the DaemonSet controller automatically schedules a pod on it. When a node is removed, the pod is garbage collected.

**Use cases:**
- Log collectors (Fluentd, Filebeat) — ship logs from every node
- Node monitoring agents (Datadog, Prometheus node-exporter)
- Network plugins (CNI agents like `vpc-cni` itself is a DaemonSet)
- Security agents that must run on every node

**Manifest — `kubernetes/DAEMONSET/daemonset.yaml`**

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: wandaprep-log-collector
  labels:
    app: wandaprep-log-collector
spec:
  selector:
    matchLabels:
      app: wandaprep-log-collector
  template:
    metadata:
      labels:
        app: wandaprep-log-collector
    spec:
      tolerations:
      - key: node-role.kubernetes.io/control-plane
        operator: Exists
        effect: NoSchedule
      containers:
      - name: log-collector
        image: busybox:1.36
        command: ["sh", "-c", "while true; do echo \"[$(date)] Node log collector running on $(hostname)\"; sleep 30; done"]
        resources:
          requests:
            cpu: "50m"
            memory: "64Mi"
          limits:
            cpu: "100m"
            memory: "128Mi"
        volumeMounts:
        - name: varlog
          mountPath: /var/log
          readOnly: true
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
```

```bash
kubectl apply -f kubernetes/DAEMONSET/daemonset.yaml
kubectl get daemonset wandaprep-log-collector
kubectl get pods -l app=wandaprep-log-collector -o wide   # one pod per node
kubectl logs -l app=wandaprep-log-collector --prefix=true
```

Expected — one pod per node, each printing:
```
[Mon Jan 1 00:00:00 UTC 2024] Node log collector running on ip-10-42-x-x
```

```bash
kubectl delete daemonset wandaprep-log-collector
```

> **Key takeaway:** Use a DaemonSet when you need exactly one instance of something on every node — not more, not less.

---

## 7. Service Discovery

Kubernetes has a built-in DNS server (CoreDNS) that automatically creates DNS records for every Service. Pods find each other by Service name — not by IP address. This is service discovery.

```
Pod A  →  DNS lookup: wandaprep-clusterip-svc  →  CoreDNS  →  ClusterIP  →  Pod B
```

Every Service gets a DNS name in the format:
```
<service-name>.<namespace>.svc.cluster.local
```

For example: `wandaprep-clusterip-svc.default.svc.cluster.local`

Within the same namespace you can use just the service name: `wandaprep-clusterip-svc`

---

### 7.1 ClusterIP (default)

A ClusterIP Service assigns a stable virtual IP address that is only reachable **inside the cluster**. It load-balances traffic across all healthy pods matching the selector.

**Use cases:**
- Internal communication between microservices
- Database connections from app pods
- Any service that should NOT be exposed to the internet

**Manifest — `kubernetes/SERVICE/clusterip-svc.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: wandaprep-clusterip-svc
spec:
  selector:
    app: wandaprep
  type: ClusterIP
  ports:
  - name: http
    port: 80
    targetPort: 8080
```

```bash
kubectl apply -f kubernetes/SERVICE/clusterip-svc.yaml
kubectl get service wandaprep-clusterip-svc
kubectl describe service wandaprep-clusterip-svc
```

**Test service discovery from inside the cluster:**

```bash
# Launch a temporary pod and curl the service by DNS name
kubectl run curl-test --image=curlimages/curl:latest --rm -it --restart=Never \
  -- curl http://wandaprep-clusterip-svc
```

The request is routed to one of the wandaprep pods — no IP address needed.

---

### 7.2 NodePort

A NodePort Service exposes the app on a static port (30000–32767) on **every node's IP**. Traffic hitting any node on that port is forwarded to the pods.

**Use cases:**
- Testing and development without a cloud load balancer
- On-premises clusters where cloud LBs are not available
- Quick external access during demos

**Manifest — `kubernetes/POD/nps-svc.yaml`**

```yaml
kind: Service
apiVersion: v1
metadata:
  name: wandaprep-app-svc
spec:
  selector:
    app: wandaprep
  type: NodePort
  ports:
  - name: tcp
    port: 80
    targetPort: 8080
    nodePort: 31200
```

```bash
kubectl apply -f kubernetes/POD/nps-svc.yaml
kubectl get service wandaprep-app-svc
curl http://<NODE_PUBLIC_IP>:31200
```

---

### 7.3 LoadBalancer

A LoadBalancer Service provisions a cloud load balancer (AWS NLB via the Load Balancer Controller) and assigns it a public DNS hostname. It is the standard way to expose apps to the internet on EKS.

**Use cases:**
- Exposing a single service to the internet
- TCP/UDP load balancing (use Ingress for HTTP routing)

**Manifest — `kubernetes/DEPLOYMENT/lb-svc.yaml`**

```yaml
kind: Service
apiVersion: v1
metadata:
  name: wandaprep-lb-svc
spec:
  selector:
    app: wandaprep
  type: LoadBalancer
  ports:
  - name: tcp
    port: 80
    targetPort: 8080
```

```bash
kubectl apply -f kubernetes/DEPLOYMENT/lb-svc.yaml
kubectl get service wandaprep-lb-svc -w    # wait for EXTERNAL-IP
curl http://xxxx.us-east-1.elb.amazonaws.com
```

---

### 7.4 Headless Service

A Headless Service has `clusterIP: None`. Instead of a single virtual IP, DNS returns the individual IP addresses of all matching pods. Clients connect directly to a specific pod.

**Use cases:**
- StatefulSets (databases, Kafka, Zookeeper) where each pod has a stable identity
- When the client needs to know which specific pod it is talking to
- Service meshes that do their own load balancing

**Manifest — `kubernetes/SERVICE/headless-svc.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: wandaprep-headless-svc
spec:
  selector:
    app: wandaprep
  clusterIP: None
  ports:
  - name: http
    port: 80
    targetPort: 8080
```

```bash
kubectl apply -f kubernetes/SERVICE/headless-svc.yaml
kubectl get service wandaprep-headless-svc   # CLUSTER-IP shows None
```

**See the difference in DNS:**

```bash
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never \
  -- nslookup wandaprep-headless-svc
# Returns individual pod IPs instead of a single ClusterIP
```

---

### 7.5 Ingress

An Ingress exposes HTTP/HTTPS routes from outside the cluster to services inside. A single Ingress can route to multiple services based on hostname or path — far more cost-efficient than one LoadBalancer per service.

On EKS with the AWS Load Balancer Controller, an Ingress provisions an ALB.

**Use cases:**
- HTTP/HTTPS routing to multiple services from one load balancer
- TLS termination
- Path-based routing (`/api` → service A, `/web` → service B)
- Host-based routing (`api.wandaprep.com` → service A, `app.wandaprep.com` → service B)

**Manifest — `kubernetes/INGRESS/ingress.yaml`**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: wandaprep-ingress
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
spec:
  rules:
  - host: app.wandaprep.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: wandaprep-lb-svc
            port:
              number: 80
```

```bash
kubectl apply -f kubernetes/INGRESS/ingress.yaml
kubectl get ingress wandaprep-ingress
kubectl describe ingress wandaprep-ingress
```

### Service Type Comparison

| Type | Reachable from | Use case |
|---|---|---|
| **ClusterIP** | Inside cluster only | Internal microservice communication |
| **NodePort** | Node IP + static port | Dev/test, on-prem |
| **LoadBalancer** | Internet via cloud LB | Single service internet exposure |
| **Headless** | Direct pod IPs via DNS | StatefulSets, service meshes |
| **Ingress** | Internet via ALB/NGINX | HTTP routing, TLS, multiple services |


---

## 8. Environment Variables, ConfigMaps, Secrets, and Volumes

Configuration should never be baked into a container image. Kubernetes provides three mechanisms to inject config at runtime: environment variables, ConfigMaps, and Secrets. Volumes extend this by mounting config as files on the container filesystem.

---

### 8.1 Environment Variables (inline)

The simplest way to pass config. Values are hardcoded directly in the manifest. Fine for non-sensitive, non-changing values.

```yaml
env:
- name: APP_COLOR
  value: "blue"
- name: APP_ENV
  value: "production"
```

**Limitation:** Changing a value requires editing and reapplying the manifest. Not suitable for values that differ between environments.

---

### 8.2 ConfigMap — env vars

A ConfigMap stores non-sensitive key-value pairs separately from the pod spec. The pod references the ConfigMap by name. Change the ConfigMap and restart the pod — no image rebuild needed.

**Manifest — `kubernetes/CONFIGMAP/configmap.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: wandaprep-config
data:
  APP_COLOR: "blue"
  APP_ENV: "production"
  APP_MESSAGE: "Welcome to WANDAPREP Kubernetes Training!"
```

```bash
kubectl apply -f kubernetes/CONFIGMAP/configmap.yaml
kubectl describe configmap wandaprep-config
```

**Inject into a pod via `valueFrom`:**

```yaml
env:
- name: APP_COLOR
  valueFrom:
    configMapKeyRef:
      name: wandaprep-config
      key: APP_COLOR
- name: APP_ENV
  valueFrom:
    configMapKeyRef:
      name: wandaprep-config
      key: APP_ENV
- name: APP_MESSAGE
  valueFrom:
    configMapKeyRef:
      name: wandaprep-config
      key: APP_MESSAGE
```

**Or inject all keys at once with `envFrom`:**

```yaml
envFrom:
- configMapRef:
    name: wandaprep-config
```

After applying the Deployment with ConfigMap refs, check the logs:

```bash
kubectl logs -l app=wandaprep --prefix=true
```

The startup banner now shows:
```
  Environment : production
  Color       : blue
  Message     : Welcome to WANDAPREP Kubernetes Training!
```

**Change the color without touching the image:**

```bash
kubectl edit configmap wandaprep-config        # change APP_COLOR to green
kubectl rollout restart deployment/wandaprep-deployment
kubectl logs -l app=wandaprep --prefix=true    # banner shows green
```

---

### 8.3 Secret — env vars

A Secret stores sensitive data (passwords, API keys, tokens). Values are base64-encoded. Kubernetes can restrict access via RBAC. Never put sensitive values in a ConfigMap.

**Encode a value:**

```bash
echo -n "wandaprep-secret-2024" | base64
# d2FuZGFwcmVwLXNlY3JldC0yMDI0
```

**Manifest — `kubernetes/SECRET/secret.yaml`**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: wandaprep-secret
type: Opaque
data:
  SECRET_KEY: d2FuZGFwcmVwLXNlY3JldC0yMDI0
```

```bash
kubectl apply -f kubernetes/SECRET/secret.yaml
kubectl describe secret wandaprep-secret      # values shown as <hidden>
```

**Inject into a pod:**

```yaml
- name: SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: wandaprep-secret
      key: SECRET_KEY
```

After applying, the startup banner shows:
```
  Secret Key  : wandaprep-secret-2024
```

The page also shows the value — injected from the Secret, not hardcoded in the image.

---

### 8.4 ConfigMap as a Volume (mounted file)

Instead of env vars, a ConfigMap can be mounted as a file on the container filesystem. This is the right pattern for config files (`.properties`, `.yaml`, `.conf`).

**Manifest — `kubernetes/VOLUMES/configmap-volume.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: wandaprep-file-config
data:
  app.properties: |
    APP_COLOR=blue
    APP_ENV=production
    APP_MESSAGE=Loaded from a mounted config file!
---
apiVersion: v1
kind: Pod
metadata:
  name: wandaprep-configmap-volume
spec:
  containers:
  - name: wandaprep-container
    image: chafah/wandaprep:v1.0
    ports:
    - containerPort: 8080
    volumeMounts:
    - name: config-volume
      mountPath: /usr/src/app/config
      readOnly: true
  volumes:
  - name: config-volume
    configMap:
      name: wandaprep-file-config
```

```bash
kubectl apply -f kubernetes/VOLUMES/configmap-volume.yaml
kubectl exec -it wandaprep-configmap-volume -- cat /usr/src/app/config/app.properties
```

Output:
```
APP_COLOR=blue
APP_ENV=production
APP_MESSAGE=Loaded from a mounted config file!
```

> **Key difference from env vars:** When you update a ConfigMap mounted as a volume, Kubernetes automatically refreshes the file inside the running container (within ~60 seconds) — no pod restart needed.

---

### 8.5 Secret as a Volume (mounted file)

Secrets can also be mounted as files. This is the correct pattern for TLS certificates, SSH keys, and API key files.

**Manifest — `kubernetes/VOLUMES/secret-volume.yaml`**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: wandaprep-tls-secret
type: Opaque
data:
  api-key: d2FuZGFwcmVwLWFwaS1rZXktMjAyNA==
---
apiVersion: v1
kind: Pod
metadata:
  name: wandaprep-secret-volume
spec:
  containers:
  - name: wandaprep-container
    image: chafah/wandaprep:v1.0
    ports:
    - containerPort: 8080
    volumeMounts:
    - name: secret-volume
      mountPath: /usr/src/app/secrets
      readOnly: true
  volumes:
  - name: secret-volume
    secret:
      secretName: wandaprep-tls-secret
```

```bash
kubectl apply -f kubernetes/VOLUMES/secret-volume.yaml
kubectl exec -it wandaprep-secret-volume -- ls /usr/src/app/secrets
kubectl exec -it wandaprep-secret-volume -- cat /usr/src/app/secrets/api-key
```

The file contains the decoded secret value — Kubernetes decodes base64 automatically when mounting.

---

### 8.6 PersistentVolumeClaim (PVC) — persistent storage

A PVC requests durable storage from the cluster. On EKS with the EBS CSI Driver and the `gp3` StorageClass, a PVC automatically creates and attaches an EBS volume. Data survives pod restarts.

**Use cases:**
- Persisting application logs
- Databases (MySQL, PostgreSQL)
- Any stateful data that must survive pod restarts

**Manifest — `kubernetes/VOLUMES/pvc-volume.yaml`**

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: wandaprep-logs-pvc
spec:
  accessModes:
  - ReadWriteOnce
  storageClassName: gp3
  resources:
    requests:
      storage: 5Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: wandaprep-pvc-volume
spec:
  containers:
  - name: wandaprep-container
    image: chafah/wandaprep:v1.0
    ports:
    - containerPort: 8080
    volumeMounts:
    - name: logs-storage
      mountPath: /usr/src/app/logs
  volumes:
  - name: logs-storage
    persistentVolumeClaim:
      claimName: wandaprep-logs-pvc
```

```bash
kubectl apply -f kubernetes/VOLUMES/pvc-volume.yaml
kubectl get pvc wandaprep-logs-pvc            # Pending → Bound
kubectl get pod wandaprep-pvc-volume
kubectl exec -it wandaprep-pvc-volume -- ls /usr/src/app/logs
```

### Volume Type Comparison

| Volume Type | Persists after pod delete? | Use case |
|---|---|---|
| `emptyDir` | No — lives with the pod | Shared scratch space between containers in a pod |
| `hostPath` | Yes — on the node | Node-level log access (DaemonSets) |
| `configMap` | N/A — read-only config | Config files mounted into containers |
| `secret` | N/A — read-only secrets | TLS certs, SSH keys, API key files |
| `persistentVolumeClaim` | Yes — EBS volume | Databases, logs, any stateful data |

---

## 9. Sidecar Pattern

A sidecar is a second container running inside the same pod as the main application container. Both containers share the same network namespace (same IP, same `localhost`) and can share volumes.

The sidecar extends or enhances the main container without modifying it. This keeps the main application image clean and single-purpose.

**Common sidecar use cases:**
- **Log shipper** — reads log files written by the app and forwards them to a central system (Elasticsearch, CloudWatch, Splunk)
- **Proxy** — intercepts and manages network traffic (Envoy in a service mesh like Istio)
- **Config reloader** — watches for ConfigMap changes and signals the app to reload
- **Metrics exporter** — scrapes app metrics and exposes them in Prometheus format

**How it works with a shared volume:**

```
Pod
├── Container: wandaprep-app
│     writes logs → /usr/src/app/logs/app.log
│     (shared emptyDir volume)
│
└── Container: log-shipper (sidecar)
      reads logs ← /logs/app.log
      prints: [SHIPPER] <timestamp> <log line>
```

**Manifest — `kubernetes/SIDECAR/sidecar.yaml`**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: wandaprep-sidecar
  labels:
    app: wandaprep
spec:
  containers:

  # Main application container
  - name: wandaprep-app
    image: chafah/wandaprep:v1.0
    ports:
    - containerPort: 8080
    env:
    - name: APP_COLOR
      value: "purple"
    - name: APP_ENV
      value: "production"
    - name: APP_MESSAGE
      value: "Running with a sidecar log shipper!"
    - name: SECRET_KEY
      value: "sidecar-demo"
    volumeMounts:
    - name: shared-logs
      mountPath: /usr/src/app/logs

  # Sidecar container — ships logs written by the main app
  - name: log-shipper
    image: busybox:1.36
    command:
    - "sh"
    - "-c"
    - |
      echo "Log shipper started. Tailing app logs..."
      while [ ! -f /logs/app.log ]; do sleep 1; done
      tail -f /logs/app.log | while read line; do
        echo "[SHIPPER] $(date -u +%Y-%m-%dT%H:%M:%SZ) $line"
      done
    volumeMounts:
    - name: shared-logs
      mountPath: /logs

  volumes:
  - name: shared-logs
    emptyDir: {}
```

```bash
kubectl apply -f kubernetes/SIDECAR/sidecar.yaml
kubectl get pod wandaprep-sidecar
```

**View the main app logs:**

```bash
kubectl logs wandaprep-sidecar -c wandaprep-app
```

```
================================================================
  ✅  IF YOU SEE THIS LOG, THE WANDAPREP APP IS RUNNING!
================================================================
  Color       : purple
  Message     : Running with a sidecar log shipper!
================================================================
```

**View the sidecar logs — it is shipping what the app writes:**

```bash
kubectl logs wandaprep-sidecar -c log-shipper
```

```
Log shipper started. Tailing app logs...
[SHIPPER] 2024-xx-xxTxx:xx:xxZ
[SHIPPER] 2024-xx-xxTxx:xx:xxZ ================================================================
[SHIPPER] 2024-xx-xxTxx:xx:xxZ   ✅  IF YOU SEE THIS LOG, THE WANDAPREP APP IS RUNNING!
[SHIPPER] 2024-xx-xxTxx:xx:xxZ ================================================================
```

**Follow both containers at once:**

```bash
kubectl logs wandaprep-sidecar --all-containers=true -f --prefix=true
```

```bash
kubectl delete pod wandaprep-sidecar
```

---

## 10. RBAC — Role-Based Access Control

RBAC controls **who** can do **what** to **which** resources in Kubernetes. Every request to the API server is authenticated (who are you?) and then authorized (are you allowed to do this?).

RBAC is built from four objects:

```
ServiceAccount  →  RoleBinding      →  Role         (namespace-scoped)
ServiceAccount  →  ClusterRoleBinding →  ClusterRole  (cluster-wide)
```

---

### 10.1 ServiceAccount

A ServiceAccount is an identity for a pod. When a pod makes API calls to the Kubernetes API server (e.g. to list pods, read ConfigMaps), it authenticates as its ServiceAccount. Every pod gets the `default` ServiceAccount unless you specify one.

**Use cases:**
- Give an app pod permission to read its own ConfigMaps and Secrets
- Give a CI/CD runner permission to deploy to a namespace
- Give a monitoring agent permission to read cluster-wide metrics

**Manifest — `kubernetes/RBAC/serviceaccount.yaml`**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: wandaprep-sa
  namespace: default
  labels:
    app: wandaprep
```

```bash
kubectl apply -f kubernetes/RBAC/serviceaccount.yaml
kubectl get serviceaccount wandaprep-sa
kubectl describe serviceaccount wandaprep-sa
```

**Assign the ServiceAccount to a pod:**

```yaml
spec:
  serviceAccountName: wandaprep-sa
  containers:
  - name: wandaprep-container
    image: chafah/wandaprep:v1.0
```

---

### 10.2 Role

A Role defines a set of permissions **within a single namespace**. It lists which API groups, resources, and verbs (actions) are allowed. A Role on its own does nothing — it must be bound to a subject via a RoleBinding.

**Verbs:** `get`, `list`, `watch`, `create`, `update`, `patch`, `delete`

**Manifest — `kubernetes/RBAC/role.yaml`**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: wandaprep-role
  namespace: default
rules:
- apiGroups: [""]
  resources: ["configmaps", "secrets"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
```

```bash
kubectl apply -f kubernetes/RBAC/role.yaml
kubectl get role wandaprep-role
kubectl describe role wandaprep-role
```

---

### 10.3 RoleBinding

A RoleBinding connects a Role to a subject (ServiceAccount, User, or Group) **within a namespace**. After this binding, the ServiceAccount has the permissions defined in the Role.

**Manifest — `kubernetes/RBAC/rolebinding.yaml`**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: wandaprep-rolebinding
  namespace: default
subjects:
- kind: ServiceAccount
  name: wandaprep-sa
  namespace: default
roleRef:
  kind: Role
  name: wandaprep-role
  apiGroup: rbac.authorization.k8s.io
```

```bash
kubectl apply -f kubernetes/RBAC/rolebinding.yaml
kubectl get rolebinding wandaprep-rolebinding
kubectl describe rolebinding wandaprep-rolebinding
```

**Test the permissions:**

```bash
kubectl auth can-i get configmaps \
  --as=system:serviceaccount:default:wandaprep-sa
# yes

kubectl auth can-i delete pods \
  --as=system:serviceaccount:default:wandaprep-sa
# no
```

---

### 10.4 ClusterRole

A ClusterRole is like a Role but **cluster-wide** — it is not scoped to a namespace. Use it for resources that exist at the cluster level (nodes, namespaces, PersistentVolumes) or when you need the same permissions across all namespaces.

**Use cases:**
- Monitoring agents that need to read pods and nodes across all namespaces
- Cluster admins
- The AWS Load Balancer Controller (needs to manage AWS resources cluster-wide)

**Manifest — `kubernetes/RBAC/clusterrole.yaml`**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: wandaprep-cluster-reader
rules:
- apiGroups: [""]
  resources: ["nodes", "namespaces", "pods", "services"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets", "daemonsets"]
  verbs: ["get", "list", "watch"]
```

```bash
kubectl apply -f kubernetes/RBAC/clusterrole.yaml
kubectl get clusterrole wandaprep-cluster-reader
kubectl describe clusterrole wandaprep-cluster-reader
```

---

### 10.5 ClusterRoleBinding

A ClusterRoleBinding connects a ClusterRole to a subject cluster-wide. After this binding, the ServiceAccount can perform the allowed actions on the specified resources in **any namespace**.

**Manifest — `kubernetes/RBAC/clusterrolebinding.yaml`**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: wandaprep-cluster-rolebinding
subjects:
- kind: ServiceAccount
  name: wandaprep-sa
  namespace: default
roleRef:
  kind: ClusterRole
  name: wandaprep-cluster-reader
  apiGroup: rbac.authorization.k8s.io
```

```bash
kubectl apply -f kubernetes/RBAC/clusterrolebinding.yaml
kubectl get clusterrolebinding wandaprep-cluster-rolebinding
```

**Test cluster-wide permissions:**

```bash
kubectl auth can-i list nodes \
  --as=system:serviceaccount:default:wandaprep-sa
# yes

kubectl auth can-i list pods -n kube-system \
  --as=system:serviceaccount:default:wandaprep-sa
# yes — cluster-wide means all namespaces
```

---

### 10.6 RBAC Decision Flow

```
kubectl request
      │
      ▼
 Authentication
 (who are you?)
      │
      ▼
 Authorization — RBAC check
 (are you allowed?)
      │
      ├── Subject: ServiceAccount / User / Group
      │
      ├── Is there a RoleBinding or ClusterRoleBinding
      │   that connects this subject to a Role/ClusterRole?
      │
      └── Does that Role/ClusterRole allow this verb
          on this resource in this namespace?
                │
                ├── YES → request proceeds
                └── NO  → 403 Forbidden
```

### RBAC Object Comparison

| Object | Scope | Purpose |
|---|---|---|
| **ServiceAccount** | Namespace | Identity for a pod to authenticate with the API server |
| **Role** | Namespace | Defines allowed actions on resources within one namespace |
| **RoleBinding** | Namespace | Grants a Role to a ServiceAccount/User within one namespace |
| **ClusterRole** | Cluster-wide | Defines allowed actions on resources across all namespaces or cluster-level resources |
| **ClusterRoleBinding** | Cluster-wide | Grants a ClusterRole to a ServiceAccount/User across the entire cluster |

---

## 11. Additional Objects

### 11.1 Namespace

Namespaces isolate groups of resources within a single cluster. Different teams, environments (dev/staging/prod), or applications each get their own namespace with independent RBAC and resource quotas.

**Manifest — `kubernetes/NAMESPACE/namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: wandaprep-prod
  labels:
    env: production
    team: wandaprep
```

```bash
kubectl apply -f kubernetes/NAMESPACE/namespace.yaml
kubectl get namespaces

# Deploy the full stack into the namespace
kubectl apply -f kubernetes/CONFIGMAP/configmap.yaml -n wandaprep-prod
kubectl apply -f kubernetes/SECRET/secret.yaml       -n wandaprep-prod
kubectl apply -f kubernetes/DEPLOYMENT/deploy.yaml   -n wandaprep-prod
kubectl get pods -n wandaprep-prod
```

### 11.2 HorizontalPodAutoscaler (HPA)

An HPA automatically scales the number of pod replicas based on CPU or memory utilisation.

**Manifest — `kubernetes/HPA/hpa.yaml`**

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: wandaprep-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: wandaprep-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 60
```

```bash
kubectl apply -f kubernetes/HPA/hpa.yaml
kubectl get hpa wandaprep-hpa
kubectl describe hpa wandaprep-hpa
```

---

## 12. Learning Progression

| Step | Topic | Object(s) | What it teaches |
|---|---|---|---|
| 1 | Workloads | **Pod** | Smallest unit. App runs with defaults. Read logs to confirm alive. |
| 2 | Workloads | **ReplicaSet** | Self-healing. Delete a pod, watch it come back. |
| 3 | Workloads | **Deployment** | Rolling updates, rollbacks, scaling. |
| 4 | Workloads | **DaemonSet** | One pod per node. Node-level agents. |
| 5 | Service Discovery | **ClusterIP** | Internal DNS. Pods find each other by name. |
| 6 | Service Discovery | **NodePort** | External access via node IP. |
| 7 | Service Discovery | **LoadBalancer** | Cloud LB. App on the internet. Color still red — no config yet. |
| 8 | Service Discovery | **Headless** | Direct pod DNS. StatefulSet use case. |
| 9 | Service Discovery | **Ingress** | HTTP routing, TLS, multiple services on one ALB. |
| 10 | Config | **ConfigMap (env)** | Inject APP_COLOR, APP_ENV, APP_MESSAGE. Page changes color. |
| 11 | Config | **Secret (env)** | Inject SECRET_KEY. Understand difference from ConfigMap. |
| 12 | Volumes | **ConfigMap volume** | Mount config as a file. Auto-refreshes without pod restart. |
| 13 | Volumes | **Secret volume** | Mount secrets as files. TLS certs, SSH keys. |
| 14 | Volumes | **PVC** | Persist logs to EBS. Data survives pod restarts. |
| 15 | Patterns | **Sidecar** | Two containers, one pod, shared volume. Log shipping pattern. |
| 16 | RBAC | **ServiceAccount** | Pod identity for API server calls. |
| 17 | RBAC | **Role + RoleBinding** | Namespace-scoped permissions. |
| 18 | RBAC | **ClusterRole + ClusterRoleBinding** | Cluster-wide permissions. |

---

## 13. Essential kubectl Commands

```bash
# Cluster
kubectl cluster-info
kubectl get nodes -o wide

# Pods
kubectl get pods -A
kubectl get pods -l app=wandaprep
kubectl describe pod <pod-name>
kubectl logs <pod-name>
kubectl logs <pod-name> -f
kubectl logs <pod-name> -c <container-name>          # specific container in a pod
kubectl logs -l app=wandaprep --prefix=true
kubectl exec -it <pod-name> -- sh
kubectl exec -it <pod-name> -c <container> -- sh     # specific container

# Workloads
kubectl get deployments
kubectl rollout status deployment/wandaprep-deployment
kubectl rollout history deployment/wandaprep-deployment
kubectl rollout undo deployment/wandaprep-deployment
kubectl rollout restart deployment/wandaprep-deployment
kubectl scale deployment wandaprep-deployment --replicas=5
kubectl get daemonset
kubectl get replicaset

# Services
kubectl get services
kubectl get service wandaprep-lb-svc -w
kubectl run curl-test --image=curlimages/curl:latest --rm -it --restart=Never -- curl http://wandaprep-clusterip-svc

# Config
kubectl get configmap wandaprep-config -o yaml
kubectl edit configmap wandaprep-config
kubectl get secret wandaprep-secret -o yaml

# Volumes
kubectl get pvc
kubectl get pv

# RBAC
kubectl get serviceaccount
kubectl get role
kubectl get rolebinding
kubectl get clusterrole wandaprep-cluster-reader
kubectl get clusterrolebinding
kubectl auth can-i <verb> <resource> --as=system:serviceaccount:<ns>:<sa-name>

# Debugging
kubectl get events --sort-by=.lastTimestamp
kubectl top pods
kubectl top nodes
kubectl apply -f <file>
kubectl delete -f <file>
```

---

## 14. Full Object Relationship Map

```
Namespace (wandaprep-prod)
│
├── Deployment (wandaprep-deployment)
│   ├── owns ──────────► ReplicaSet
│   │                     └── manages ──► Pod  Pod  Pod
│   │                                      └── Container: chafah/wandaprep:v1.0
│   │                                            ├── env  ◄── ConfigMap (APP_COLOR, APP_ENV, APP_MESSAGE)
│   │                                            ├── env  ◄── Secret    (SECRET_KEY)
│   │                                            └── vol  ◄── PVC ──► EBS gp3
│   │
│   ├── exposed by ────► Service/ClusterIP    (internal DNS only)
│   ├── exposed by ────► Service/NodePort     (node IP:31200)
│   ├── exposed by ────► Service/LoadBalancer (AWS NLB → port 80)
│   ├── exposed by ────► Ingress              (AWS ALB → app.wandaprep.com)
│   └── scaled by ─────► HorizontalPodAutoscaler (2–10 replicas)
│
├── DaemonSet (wandaprep-log-collector)
│   └── one Pod per Node ──► hostPath /var/log
│
├── Pod (wandaprep-sidecar)
│   ├── Container: wandaprep-app   ──► writes logs to emptyDir
│   └── Container: log-shipper    ◄── reads logs from emptyDir
│
└── RBAC
    ├── ServiceAccount (wandaprep-sa)
    │   ├── bound by RoleBinding ──► Role (read configmaps/secrets in default ns)
    │   └── bound by ClusterRoleBinding ──► ClusterRole (read nodes/pods cluster-wide)
    └── used by pods via: spec.serviceAccountName: wandaprep-sa
```
