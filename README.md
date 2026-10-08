# wandaprep-app — Build, Deploy & Infrastructure Guide

## Prerequisites

| Tool        | Version  | Install                                      |
| ----------- | -------- | -------------------------------------------- |
| Docker      | 24+      | https://docs.docker.com/get-docker           |
| AWS CLI     | 2.x      | https://aws.amazon.com/cli                   |
| Terraform   | >= 1.5.0 | https://developer.hashicorp.com/terraform    |
| kubectl     | 1.32+    | https://kubernetes.io/docs/tasks/tools       |
| Helm        | 3.x      | https://helm.sh/docs/intro/install           |

---

## 1. AWS Profile Setup

The Terraform and AWS CLI commands in this guide use the `production` AWS profile.

Configure it once:

```bash
aws configure --profile production
```

You will be prompted for:
- AWS Access Key ID
- AWS Secret Access Key
- Default region: `us-east-1`
- Default output format: `json`

Verify it works:

```bash
aws sts get-caller-identity --profile production
```

---

## 2. Build the Docker Image

From the repo root:

```bash
cd wandaprep-app
docker build -t wandaprep-app:latest .
```

Tag for a specific version:

```bash
docker tag wandaprep-app:latest wandaprep-app:v1.0
```

---

## 3. Push to Docker Hub

### Authenticate

```bash
docker login
```

Enter your Docker Hub username and password when prompted.

### Tag and push

```bash
# Replace <dockerhub-username> with your Docker Hub username
docker tag wandaprep-app:latest <dockerhub-username>/wandaprep-app:latest
docker tag wandaprep-app:latest <dockerhub-username>/wandaprep-app:v1.0

docker push <dockerhub-username>/wandaprep-app:latest
docker push <dockerhub-username>/wandaprep-app:v1.0
```

---

## 4. Push to Amazon ECR

### Authenticate

```bash
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile production)
AWS_REGION=us-east-1

aws ecr get-login-password --region $AWS_REGION --profile production \
  | docker login --username AWS --password-stdin \
    $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

### Tag and push

```bash
ECR_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/wandaprep-app

docker tag wandaprep-app:latest $ECR_URI:latest
docker tag wandaprep-app:latest $ECR_URI:v1.0

docker push $ECR_URI:latest
docker push $ECR_URI:v1.0
```

> The ECR repository `wandaprep-app` is created by Terraform in the next step.
> Run `terraform apply` first if the repository does not exist yet.

---

## 5. Provision the Cluster with Terraform

### Infrastructure overview

The Terraform code provisions:

| Resource                        | Details                                                  |
| ------------------------------- | -------------------------------------------------------- |
| VPC                             | Public + private subnets across 2–3 AZs, NAT gateway    |
| EKS cluster                     | `wandaprep-cluster-<env>`, Kubernetes 1.32               |
| Managed node group              | `t3.medium` (dev/stg) or `t3.large` (prod)              |
| AWS Load Balancer Controller    | Deployed via Helm, IRSA-backed service account           |
| ECR repository                  | `wandaprep-app` — single image repository                |
| CloudWatch log group            | `/wandaprep-app`, 14-day retention                       |
| S3 bucket                       | `wandaprep-bucket-<env>`, versioned, private             |
| IAM IRSA roles                  | EBS CSI, LB controller, app service account             |

### Subnet tags (required for Ingress and Load Balancer)

The VPC module automatically applies the correct Kubernetes subnet tags:

```
# Public subnets — used by internet-facing ALBs
kubernetes.io/role/elb = 1
kubernetes.io/cluster/wandaprep-cluster-<env> = shared

# Private subnets — used by internal ALBs and EKS nodes
kubernetes.io/role/internal-elb = 1
kubernetes.io/cluster/wandaprep-cluster-<env> = shared
```

These tags are required for the AWS Load Balancer Controller to discover subnets when creating an Ingress.

### AWS Load Balancer Controller

The controller is deployed automatically via `helm.tf` as part of `terraform apply`. It:
- Runs in the `kube-system` namespace
- Uses the `aws-load-balancer-controller` service account
- Is bound to the `wandaprep-cluster-<env>-lb-controller` IAM role via IRSA
- Watches for `Ingress` resources with `kubernetes.io/ingress.class: alb` and provisions ALBs

### Initialize Terraform

```bash
cd terraform
terraform init
```

### Plan against an environment

```bash
# dev
terraform plan -var-file="env/dev/terraform.tfvars"

# stg
terraform plan -var-file="env/stg/terraform.tfvars"

# prod
terraform plan -var-file="env/prod/terraform.tfvars"
```

### Apply

```bash
# dev
terraform apply -var-file="env/dev/terraform.tfvars"

# prod (review plan carefully before applying)
terraform apply -var-file="env/prod/terraform.tfvars"
```

Type `yes` when prompted to confirm.

### Outputs after apply

```
cluster_name           = "wandaprep-cluster-dev"
cluster_endpoint       = "https://..."
ecr_app_url            = "<account>.dkr.ecr.us-east-1.amazonaws.com/wandaprep-app"
app_bucket_name        = "wandaprep-bucket-dev"
app_irsa_role_arn      = "arn:aws:iam::<account>:role/wandaprep-cluster-dev-app-sa"
lb_controller_role_arn = "arn:aws:iam::<account>:role/wandaprep-cluster-dev-lb-controller"
kubeconfig_command     = "aws eks update-kubeconfig --name wandaprep-cluster-dev --region us-east-1 --profile production"
```

---

## 6. Access the Cluster

### Update kubeconfig

Copy and run the `kubeconfig_command` from the Terraform output, or run:

```bash
aws eks update-kubeconfig \
  --name wandaprep-cluster-dev \
  --region us-east-1 \
  --profile production
```

### Verify access

```bash
kubectl get nodes
kubectl get pods -n kube-system
```

### Verify the Load Balancer Controller is running

```bash
kubectl get deployment aws-load-balancer-controller -n kube-system
kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller
```

Expected output:

```
NAME                           READY   UP-TO-DATE   AVAILABLE
aws-load-balancer-controller   2/2     2            2
```

---

## 7. Deploy the Application

Apply the Kubernetes manifests:

```bash
kubectl apply -f kubernetes/NAMESPACE/namespace.yaml
kubectl apply -f kubernetes/CONFIGMAP/configmap.yaml
kubectl apply -f kubernetes/SECRET/secret.yaml
kubectl apply -f kubernetes/DEPLOYMENT/deploy.yaml
kubectl apply -f kubernetes/DEPLOYMENT/lb-svc.yaml
kubectl apply -f kubernetes/INGRESS/ingress.yaml
```

### Verify the Ingress and ALB

```bash
kubectl get ingress -n wandaprep
```

The `ADDRESS` column will show the ALB DNS name once the controller has provisioned it (usually 1–2 minutes).

```bash
kubectl describe ingress wandaprep-ingress -n wandaprep
```

---

## 8. Destroy the Infrastructure

```bash
terraform destroy -var-file="env/dev/terraform.tfvars"
```

> Always destroy dev/stg before prod. Ensure no PVCs or load balancers created by Kubernetes remain, as Terraform cannot delete AWS resources it did not create.

---

## Troubleshooting

| Symptom                                  | Resolution                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NoCredentialProviders`                  | Run `aws configure --profile production` and verify with `aws sts get-caller-identity`       |
| ECR login fails                          | Ensure the IAM user/role has `ecr:GetAuthorizationToken` permission                         |
| Ingress stuck with no ADDRESS            | Check LB controller logs: `kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller` |
| Subnet not found by LB controller        | Confirm subnet tags include `kubernetes.io/role/elb=1` and the correct cluster tag          |
| `kubectl` returns `Unauthorized`         | Re-run `aws eks update-kubeconfig` with `--profile production`                              |
| Nodes not joining cluster                | Check node group IAM role has `AmazonEKSWorkerNodePolicy` and `AmazonEKS_CNI_Policy`        |
