# Expo Router Entry Point
import { registerRootComponent } from 'expo-router'
import 'react-native-gesture-handler'

registerRootComponent(require('./app/index.tsx'))
