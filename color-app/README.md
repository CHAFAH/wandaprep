# Hilltop Consultancy Color Display Application

This is a simple **Node.js web application** that dynamically displays a webpage with a customizable background color. The background color is set during the **Docker build process** using the `COLOR` build argument.

Each version of the application represents a **different color**, and multiple versions can run simultaneously using Docker.

---

## **📌 Prerequisites**
Ensure you have the following installed on your system:
- **Docker** ([Download Docker](https://www.docker.com/get-started))
- **Git** (Optional, for cloning the repository)
- **Kubernetes CLI (`kubectl`)** ([Install kubectl](https://kubernetes.io/docs/tasks/tools/))

---

## **📌 Cloning the Repository**
Clone this repository to your local machine:
```sh
git clone https://github.com/HILL-TOPCONSULTANCY/COLOR-APP.git
cd COLOR-APP
```
---

## **📌 Understanding Port Mapping in Docker**
When running the application using Docker, **the application inside the container always runs on port `8080`**.  
However, we use **port mapping** (`-p <host-port>:8080`) to expose different color versions on different **host ports**.

For example:
```sh
docker run -d -p 8081:8080 hilltopconsultancy/color-app:red
```
This maps **port 8080 inside the container** to **port 8081 on the host**.

Thus, even though the logs show:
```
Server is running on http://localhost:8080
```
You access the application via:
```
http://localhost:8081
```
because **8081 is mapped to 8080**.

---

## **📌 Building Docker Images with Different Colors**
Build different versions using the `--build-arg COLOR=<color>` flag:

```sh
docker build --no-cache --build-arg COLOR=red -t hilltopconsultancy/color-app:red .
docker build --no-cache --build-arg COLOR=blue -t hilltopconsultancy/color-app:blue .
docker build --no-cache --build-arg COLOR=green -t hilltopconsultancy/color-app:green .
docker build --no-cache --build-arg COLOR=orange -t hilltopconsultancy/color-app:orange .
docker build --no-cache --build-arg COLOR=pink -t hilltopconsultancy/color-app:pink .
```

---

## **📌 Running the Application with Docker**
Run different colors on different **host ports**:

```sh
docker run -d -p 8081:8080 hilltopconsultancy/color-app:red
docker run -d -p 8082:8080 hilltopconsultancy/color-app:blue
docker run -d -p 8083:8080 hilltopconsultancy/color-app:green
docker run -d -p 8084:8080 hilltopconsultancy/color-app:orange
docker run -d -p 8085:8080 hilltopconsultancy/color-app:pink
```
---

## **📌 Pushing to Docker Hub**
To push your images to Docker Hub:
```sh
docker push <UserName>/<Repo>:red
```

Now, the images can be pulled and deployed anywhere.
---

## **📌 Accessing the Application**
Open a browser and visit the following URLs:

| Color  | URL |
|--------|--------------------------------|
| **Red** | [http://localhost:8081](http://localhost:8081) |
| **Blue** | [http://localhost:8082](http://localhost:8082) |
| **Green** | [http://localhost:8083](http://localhost:8083) |
| **Orange** | [http://localhost:8084](http://localhost:8084) |
| **Pink** | [http://localhost:8085](http://localhost:8085) |

---

## **📌 Deploying to Kubernetes**
To deploy the **red color version** in Kubernetes, we will use:
1. **A ConfigMap** to store the `COLOR` variable
2. **A Deployment** to run the application
3. **A NodePort Service** to expose the application

### **1️⃣ Create a ConfigMap for the Red Color**
Create a file called **`color-configmap.yaml`**:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: color-config
data:
  COLOR: "red"
```
Apply it to the cluster:
```sh
kubectl apply -f color-configmap.yaml
```

---

### **2️⃣ Create a Deployment for the Red Version**
Create a file called **`color-deployment.yaml`**:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: color-app-red
spec:
  replicas: 2
  selector:
    matchLabels:
      app: color-app-red
  template:
    metadata:
      labels:
        app: color-app-red
    spec:
      containers:
      - name: color-app
        image: hilltopconsultancy/color-app:red  # Pull from Docker Hub
        ports:
        - containerPort: 8080
        envFrom:
        - configMapRef:
            name: color-config
```
Apply it to the cluster:
```sh
kubectl apply -f color-deployment.yaml
```

---

### **3️⃣ Create a NodePort Service to Expose the Application**
Create a file called **`color-service.yaml`**:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: color-app-service
spec:
  type: NodePort
  selector:
    app: color-app-red
  ports:
    - protocol: TCP
      port: 8080
      targetPort: 8080
      nodePort: 30080  # Exposed on NodePort 30080
```
Apply it to the cluster:
```sh
kubectl apply -f color-service.yaml
```

---

## **📌 Accessing the Kubernetes Deployment**
Once the application is deployed, get the **Minikube or cluster IP**:
```sh
minikube ip  # If using Minikube
```
Then access it via:
```
http://<NODE_IP>:30080
```

---

## **📌 Viewing Logs**
To see logs of the running Kubernetes Pods:
```sh
kubectl get pods 
kubectl logs -f <POD_NAME>
```

---

## **📌 Scaling the Deployment**
To scale the **red color application** to 5 instances:
```sh
kubectl scale deployment color-app-red --replicas=5
```

---

## **📌 Deleting the Deployment**
To remove the application:
```sh
kubectl delete deployment color-app-red
kubectl delete service color-app-service
kubectl delete configmap color-config
```

---

## **📌 Conclusion**
This guide covers:
- **Building and running the application with Docker**
- **Understanding port mapping (`-p <host-port>:8080`)**
- **Deploying the red version on Kubernetes using ConfigMaps, Deployments, and NodePort Services**
- **Scaling and managing the deployment**
- **Pushing and pulling images from Docker Hub**

🚀 Now you can **deploy and run multiple color variations of the app on Kubernetes!** 🎨🔥  
For questions, feel free to **reach out** or contribute to this project.

---