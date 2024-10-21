# Usa una imagen base de Node.js
FROM node:18

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copia el archivo package.json y package-lock.json al contenedor
COPY package*.json ./

# Instala las dependencias de la aplicación
RUN npm install

# Copia el resto de los archivos de la aplicación al contenedor
COPY . .

# Expone el puerto en el que se ejecuta la aplicación (el valor por defecto de Express es 3000)
EXPOSE 3000

# Establece la variable de entorno para producción
ENV NODE_ENV=staging

# Especifica el comando para ejecutar la aplicación
CMD ["node", "index.js"]
