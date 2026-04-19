# Use the official Node.js 20 image as the base image
FROM node:20-alpine AS builder

# Set the working directory in the container
WORKDIR /app

# Copy the package.json and package-lock.json files to the working directory
COPY package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Build the Next.js application
RUN npm run build

# Use the official Node.js 20 image for running the application
FROM node:20-alpine AS runner

# Set the working directory in the container
WORKDIR /app

# Copy the standalone build output from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./

RUN npm install --production

# Expose the port the application will run on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]