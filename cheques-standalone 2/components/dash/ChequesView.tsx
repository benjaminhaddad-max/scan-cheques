'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Upload, Play, PlayCircle, CheckCircle2, AlertCircle, Clock, Trash2, RotateCcw, Calendar, PenTool, Folder, FolderOpen, Edit3, ChevronDown, ChevronRight, X } from 'lucide-react';

interface ChequeUpload {
  id: string;
  blobUrl: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  model?: string;
  attempts: number;
  error?: string;
  rawText?: string;
  parsedJson?: any;
  confidence?: number;
  folderId?: string;
  folderName?: string;
  folderOrder?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface UploadPreview {
  file: File;
  previewUrl: string;
}

interface FolderGroup {
  id: string;
  name: string;
  items: ChequeUpload[];
  isExpanded: boolean;
  bulkEditData?: EditableFields;
}

interface EditableFields {
  checkNumber?: string;
  checkNumberMICR?: string;
  amount?: string;
  date?: string;
  location?: string;
  bank?: string;
  accountNumber?: string;
  routingNumber?: string;
  payTo?: string;
  emetteur?: string;
  memo?: string;
  rawText?: string;
  isDated?: boolean;
  isSigned?: boolean;
}

export default function ChequesView() {
  const [items, setItems] = useState<ChequeUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<ChequeUpload | null>(null);
  const [editedFields, setEditedFields] = useState<EditableFields>({});
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Folder grouping states
  const [folders, setFolders] = useState<FolderGroup[]>([]);
  const [uploadPreviews, setUploadPreviews] = useState<UploadPreview[]>([]);
  const [showUploadPreview, setShowUploadPreview] = useState(false);
  const [bulkEditFolder, setBulkEditFolder] = useState<FolderGroup | null>(null);
  const [emetteurContext, setEmetteurContext] = useState<string>('');
  const [showEmetteurContext, setShowEmetteurContext] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ocr/uploads');
      
      if (!res.ok) {
        console.error('Failed to fetch uploads:', res.status, res.statusText);
        setItems([]);
        setLoading(false);
        return;
      }
      
      const text = await res.text();
      if (!text) {
        console.error('Empty response from server');
        setItems([]);
        setLoading(false);
        return;
      }
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError, 'Response text:', text);
        setItems([]);
        setLoading(false);
        return;
      }
      
      const items = data.items || [];
      setItems(items);
      organizeFolders(items);
    } catch (error) {
      console.error('Error loading uploads:', error);
      setItems([]);
      setFolders([]);
    }
    setLoading(false);
  };

  const organizeFolders = (items: ChequeUpload[]) => {
    const folderMap = new Map<string, FolderGroup>();
    
    // Group items by folderId
    items.forEach(item => {
      if (item.folderId && item.folderName) {
        if (!folderMap.has(item.folderId)) {
          folderMap.set(item.folderId, {
            id: item.folderId,
            name: item.folderName,
            items: [],
            isExpanded: false
          });
        }
        folderMap.get(item.folderId)?.items.push(item);
      }
    });

    // Sort items within folders by folderOrder, then by fileName
    folderMap.forEach(folder => {
      folder.items.sort((a, b) => {
        const orderA = a.folderOrder || 0;
        const orderB = b.folderOrder || 0;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.fileName.localeCompare(b.fileName);
      });
    });

    setFolders(Array.from(folderMap.values()));
  };

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    
    // Create upload previews with URLs for display
    const previews: UploadPreview[] = files.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file)
    }));
    
    setUploadPreviews(previews);
    setShowUploadPreview(true);
  };

  const confirmUpload = async () => {
    if (uploadPreviews.length === 0) return;
    
    setUploading(true);
    setShowUploadPreview(false);
    
    const maxParallel = 3;
    const uploadQueue: (() => Promise<void>)[] = [];
    
    // Process all files without grouping
    uploadPreviews.forEach(preview => {
      uploadQueue.push(async () => {
        const isZip = preview.file.type === 'application/zip' || 
                     preview.file.name.toLowerCase().endsWith('.zip');

        if (isZip) {
          // Handle ZIP file
          const formData = new FormData();
          formData.append('file', preview.file);

          const uploadResp = await fetch('/api/ocr/upload-zip', {
            method: 'POST',
            body: formData,
          });
          
          if (!uploadResp.ok) throw new Error('ZIP upload failed');
          const result = await uploadResp.json();
          
          if (!result.success) {
            throw new Error(result.error || 'ZIP processing failed');
          }

          // Enqueue all extracted files
          if (result.files && result.files.length > 0) {
            const filesToEnqueue = result.files.map((file: any) => ({
              url: file.url,
              fileName: file.filename,
              sizeBytes: file.size
            }));

            await fetch('/api/ocr/enqueue', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ files: filesToEnqueue }),
            });
          }
        } else {
          // Handle regular image file
          const formData = new FormData();
          formData.append('file', preview.file);

          const uploadResp = await fetch('/api/ocr/upload', {
            method: 'POST',
            body: formData,
          });
          
          if (!uploadResp.ok) throw new Error('Upload failed');
          const { url: blobUrl } = await uploadResp.json();
          
          await fetch('/api/ocr/enqueue', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ files: [{ url: blobUrl, fileName: preview.file.name, sizeBytes: preview.file.size }] }),
          });
        }
      });
    });

    let idx = 0;
    const runners = Array(Math.min(maxParallel, uploadQueue.length))
      .fill(0)
      .map(async () => {
        while (idx < uploadQueue.length) {
          const run = uploadQueue[idx++];
          await run();
        }
      });
    
    try {
      await Promise.all(runners);
      await load();
    } catch (error) {
      console.error('Upload failed:', error);
    }
    
    // Cleanup preview URLs
    uploadPreviews.forEach(preview => {
      URL.revokeObjectURL(preview.previewUrl);
    });
    setUploadPreviews([]);
    setUploading(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    handleFileUpload(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type.startsWith('image/') || 
      file.type === 'image/tiff' || 
      file.name.toLowerCase().endsWith('.tiff') || 
      file.name.toLowerCase().endsWith('.tif') ||
      file.type === 'application/zip' ||
      file.name.toLowerCase().endsWith('.zip')
    );
    handleFileUpload(files);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const processItem = async (itemId: string) => {
    // Immediately update UI to show processing state
    setItems(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, status: 'RUNNING', startedAt: new Date().toISOString() }
        : item
    ));
    
    setIsProcessing(true);
    
    const contextList = emetteurContext.trim() 
      ? emetteurContext.trim().split('\n').filter(line => line.trim())
      : [];
    
    // Only include context in request if list is not empty
    const requestBody = contextList.length > 0 
      ? { emetteurContext: contextList }
      : {};
    
    const fetchOptions = {
      method: 'POST',
      ...(contextList.length > 0 && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
    };
    
    await fetch(`/api/ocr/process-pending?limit=1&itemId=${itemId}`, fetchOptions);
    await load();
    setIsProcessing(false);
  };

  const processSelected = async () => {
    if (selectedItems.size === 0) return;
    
    // Immediately update UI to show processing state for selected items
    setItems(prev => prev.map(item => 
      selectedItems.has(item.id)
        ? { ...item, status: 'RUNNING', startedAt: new Date().toISOString() }
        : item
    ));
    
    setIsProcessing(true);
    
    const ids = Array.from(selectedItems).join(',');
    const contextList = emetteurContext.trim() 
      ? emetteurContext.trim().split('\n').filter(line => line.trim())
      : [];
    
    // Only include context in request if list is not empty
    const requestBody = contextList.length > 0 
      ? { emetteurContext: contextList }
      : {};
    
    const fetchOptions = {
      method: 'POST',
      ...(contextList.length > 0 && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
    };
    
    // Process in batches until all selected items are done
    let hasMore = true;
    while (hasMore) {
      const response = await fetch(`/api/ocr/process-pending?itemIds=${ids}`, fetchOptions);
      const result = await response.json();
      hasMore = result.hasMore || false;
      
      // Refresh the list after each batch
      await load();
      
      // Small delay to avoid overwhelming the UI (reduced for speed)
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    setIsProcessing(false);
  };

  const processAll = async () => {
    // Immediately update UI to show processing state for all pending items
    setItems(prev => prev.map(item => 
      item.status === 'PENDING'
        ? { ...item, status: 'RUNNING', startedAt: new Date().toISOString() }
        : item
    ));
    
    setIsProcessing(true);
    
    const contextList = emetteurContext.trim() 
      ? emetteurContext.trim().split('\n').filter(line => line.trim())
      : [];
    
    // Only include context in request if list is not empty
    const requestBody = contextList.length > 0 
      ? { emetteurContext: contextList }
      : {};
    
    const fetchOptions = {
      method: 'POST',
      ...(contextList.length > 0 && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
    };
    
    // Process in batches until all items are done
    let hasMore = true;
    let batchCount = 0;
    while (hasMore) {
      batchCount++;
      console.log(`🔄 Processing batch ${batchCount}...`);
      
      const response = await fetch('/api/ocr/process-pending?limit=5000', fetchOptions);
      const result = await response.json();
      hasMore = result.hasMore || false;
      
      console.log(`✅ Batch ${batchCount} complete: ${result.processed} processed, ${result.remaining || 0} remaining`);
      
      // Refresh the list after each batch
      await load();
      
      // Small delay to avoid overwhelming the UI and API (reduced for speed)
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`🎉 All batches complete! Total batches: ${batchCount}`);
    setIsProcessing(false);
  };

  const cancelProcessing = async () => {
    if (!window.confirm('Annuler tous les traitements en cours et remettre en attente ?')) {
      return;
    }
    
    try {
      const response = await fetch('/api/ocr/cancel-processing', {
        method: 'POST'
      });
      
      if (!response.ok) throw new Error('Cancel failed');
      
      const result = await response.json();
      console.log(`✅ ${result.count} items cancelled`);
      
      // Reload the list to reflect changes
      await load();
    } catch (error) {
      console.error('Cancel processing failed:', error);
      alert('Erreur lors de l\'annulation des traitements');
    }
  };

  const toggleSelection = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const openPreview = (item: ChequeUpload) => {
    setPreviewItem(item);
    setEditedFields(item.parsedJson || {});
  };

  const saveFields = async () => {
    if (!previewItem) return;
    
    await fetch(`/api/ocr/uploads/${previewItem.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsedJson: editedFields }),
    });
    
    setPreviewItem(null);
    await load();
  };

  const deleteFile = async (item: ChequeUpload) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${item.fileName}" ?`)) {
      return;
    }
    
    try {
      const response = await fetch(`/api/ocr/uploads/${item.id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        // Refresh the list
        await load();
      }
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  };

  const rerunFile = async (item: ChequeUpload) => {
    try {
      // Reset the item to PENDING status
      const resetResponse = await fetch(`/api/ocr/uploads/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: 'PENDING',
          error: null,
          rawText: null,
          parsedJson: null,
          confidence: null,
          startedAt: null,
          completedAt: null
        }),
      });
      
      if (resetResponse.ok) {
        // Process the single item
        await fetch(`/api/ocr/process-pending?itemId=${item.id}`, { method: 'POST' });
        // Refresh the list
        await load();
      }
    } catch (error) {
      console.error('Error rerunning file:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'FAILED': return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'RUNNING': return <Clock className="w-4 h-4 text-blue-500 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-green-100 text-green-800';
      case 'FAILED': return 'bg-red-100 text-red-800';
      case 'RUNNING': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getConfidenceColor = (confidence?: number) => {
    if (!confidence) return 'bg-gray-100 text-gray-800';
    if (confidence >= 80) return 'bg-green-100 text-green-800';
    if (confidence >= 60) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const getConfidenceText = (confidence?: number) => {
    if (!confidence) return 'N/A';
    return `${confidence}%`;
  };

  // Folder management functions
  const toggleFolder = (folderId: string) => {
    setFolders(prev => prev.map(folder => 
      folder.id === folderId 
        ? { ...folder, isExpanded: !folder.isExpanded }
        : folder
    ));
  };

  const openBulkEdit = (folder: FolderGroup) => {
    setBulkEditFolder({ ...folder, bulkEditData: {} });
  };

  const saveBulkEdit = async () => {
    if (!bulkEditFolder || !bulkEditFolder.bulkEditData) return;
    
    const updates = bulkEditFolder.items.map(item => ({
      id: item.id,
      parsedJson: { ...item.parsedJson, ...bulkEditFolder.bulkEditData }
    }));
    
    try {
      await Promise.all(
        updates.map(update => 
          fetch(`/api/ocr/uploads/${update.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ parsedJson: update.parsedJson }),
          })
        )
      );
      
      setBulkEditFolder(null);
      await load();
    } catch (error) {
      console.error('Bulk edit failed:', error);
    }
  };

  useEffect(() => {
    load();
    // Load emetteur context from localStorage
    const savedContext = localStorage.getItem('emetteur-context');
    if (savedContext) {
      setEmetteurContext(savedContext);
    }
  }, []);

  // Polling effect: Refresh data while processing is happening
  useEffect(() => {
    if (isProcessing) {
      // Start polling every 2 seconds while processing
      pollingIntervalRef.current = setInterval(() => {
        load();
      }, 2000);
    } else {
      // Stop polling when processing is done
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [isProcessing]);

  // Save emetteur context to localStorage when it changes
  useEffect(() => {
    if (emetteurContext.trim()) {
      localStorage.setItem('emetteur-context', emetteurContext);
    }
  }, [emetteurContext]);

  // Filter items that are not in folders
  const ungroupedItems = items.filter(item => !item.folderId);
  const notProcessedUngrouped = ungroupedItems.filter(item => item.status === 'PENDING' || item.status === 'RUNNING');
  const processedUngrouped = ungroupedItems.filter(item => item.status === 'COMPLETED' || item.status === 'FAILED');
  
  // Filter folders by processing status
  const notProcessedFolders = folders.filter(folder => 
    folder.items.some(item => item.status === 'PENDING' || item.status === 'RUNNING')
  );
  const processedFolders = folders.filter(folder => 
    folder.items.every(item => item.status === 'COMPLETED' || item.status === 'FAILED')
  );

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Traitement des chèques</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={processSelected} disabled={selectedItems.size === 0 || isProcessing} variant="outline">
            <Play className="w-4 h-4 mr-2" />
            Traiter la sélection ({selectedItems.size})
          </Button>
          <Button onClick={processAll} disabled={(notProcessedUngrouped.length === 0 && notProcessedFolders.length === 0) || isProcessing}>
            <PlayCircle className="w-4 h-4 mr-2" />
            Tout traiter
          </Button>
          <Button 
            onClick={cancelProcessing} 
            disabled={items.filter(i => i.status === 'RUNNING').length === 0}
            variant="outline"
            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
          >
            <X className="w-4 h-4 mr-2" />
            Annuler traitements ({items.filter(i => i.status === 'RUNNING').length})
          </Button>
        </div>
      </div>

      {/* Emetteur Context Section */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowEmetteurContext(!showEmetteurContext)}
          className="mb-2"
        >
          {showEmetteurContext ? <ChevronDown className="w-4 h-4 mr-2" /> : <ChevronRight className="w-4 h-4 mr-2" />}
          Liste des émetteurs (contexte)
        </Button>
        
        {showEmetteurContext && (
          <Card className="p-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Liste des émetteurs connus (un par ligne)
              </Label>
              <p className="text-xs text-gray-600 mb-2">
                Cette liste sera utilisée pour standardiser les noms d'émetteurs lors du traitement OCR
              </p>
              <Textarea
                value={emetteurContext}
                onChange={(e) => setEmetteurContext(e.target.value)}
                placeholder={`Exemple:\nSOCIETE ABC\nENTREPRISE XYZ\nCOMPAGNIE 123\n...`}
                className="min-h-[120px] text-sm"
              />
              <div className="text-xs text-gray-500">
                {emetteurContext.trim() ? 
                  `${emetteurContext.trim().split('\n').filter(line => line.trim()).length} émetteur(s) dans la liste` : 
                  'Aucun émetteur dans la liste'
                }
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Upload Tile */}
      <div className="mb-8">
        <Card 
          className={`border-2 border-dashed transition-colors cursor-pointer ${
            isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Upload className={`w-12 h-12 mb-4 ${isDragOver ? 'text-blue-500' : 'text-gray-400'}`} />
            <div className="text-center">
              <p className="text-lg font-medium mb-2">
                {uploading ? 'Importation en cours...' : 'Déposez vos images ici ou cliquez pour importer'}
              </p>
              <p className="text-sm text-gray-500">
                Formats supportés : JPG, PNG, GIF, TIFF, ZIP
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.tiff,.tif,.zip"
              multiple
              onChange={handleFileInput}
              className="hidden"
            />
          </CardContent>
        </Card>
      </div>

      {/* Not Processed Section */}
      {(notProcessedUngrouped.length > 0 || notProcessedFolders.length > 0) && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Non traités ({notProcessedUngrouped.length + notProcessedFolders.reduce((acc, folder) => acc + folder.items.length, 0)})
          </h2>
          
          {/* Folders */}
          {notProcessedFolders.map((folder) => (
            <div key={folder.id} className="mb-6">
              <div 
                className="flex items-center gap-2 mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded"
                onClick={() => toggleFolder(folder.id)}
              >
                {folder.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {folder.isExpanded ? <FolderOpen className="w-5 h-5 text-blue-600" /> : <Folder className="w-5 h-5 text-blue-600" />}
                <span className="font-medium text-gray-900">{folder.name}</span>
                <Badge variant="outline" className="text-xs">{folder.items.length} élément{folder.items.length > 1 ? 's' : ''}</Badge>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={(e) => {
                    e.stopPropagation();
                    openBulkEdit(folder);
                  }}
                >
                  <Edit3 className="w-3 h-3 mr-1" />
                  Modifier en lot
                </Button>
              </div>
              
              {folder.isExpanded && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 ml-8">
                  {folder.items.map((item) => (
                    <ContextMenu key={item.id}>
                      <ContextMenuTrigger>
                        <Card className="group hover:shadow-md transition-shadow">
                          <CardContent className="p-3">
                            <div className="relative">
                              <img 
                                src={item.blobUrl} 
                                alt={item.fileName}
                                className="w-full h-32 object-cover rounded mb-2 cursor-pointer"
                                onClick={() => openPreview(item)}
                              />
                              <div className="absolute top-2 left-2">
                                <Checkbox
                                  checked={selectedItems.has(item.id)}
                                  onCheckedChange={() => toggleSelection(item.id)}
                                  className="bg-white/80"
                                />
                              </div>
                              <div className="absolute top-2 right-2">
                                <Badge className={getStatusColor(item.status)}>
                                  {getStatusIcon(item.status)}
                                </Badge>
                              </div>
                              {item.status === 'RUNNING' && (
                                <div className="absolute inset-0 bg-blue-500/20 rounded flex items-center justify-center">
                                  <div className="bg-white/90 rounded-lg px-3 py-2 shadow-lg">
                                    <div className="flex items-center space-x-2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                                      <span className="text-sm font-medium text-blue-700">Traitement...</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {item.status === 'PENDING' && (
                                <Button
                                  size="sm"
                                  className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    processItem(item.id);
                                  }}
                                >
                                  <Play className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                            <p className="text-xs font-medium truncate" title={item.fileName}>
                              {item.fileName}
                            </p>
                            <p className="text-xs text-gray-500">
                              {(item.sizeBytes / 1024).toFixed(1)}KB
                            </p>
                          </CardContent>
                        </Card>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => deleteFile(item)}>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Supprimer
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              )}
            </div>
          ))}
          
          {/* Ungrouped Items */}
          {notProcessedUngrouped.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {notProcessedUngrouped.map((item) => (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger>
                    <Card className="group hover:shadow-md transition-shadow">
                      <CardContent className="p-3">
                        <div className="relative">
                          <img 
                            src={item.blobUrl} 
                            alt={item.fileName}
                            className="w-full h-32 object-cover rounded mb-2 cursor-pointer"
                            onClick={() => openPreview(item)}
                          />
                          <div className="absolute top-2 left-2">
                            <Checkbox
                              checked={selectedItems.has(item.id)}
                              onCheckedChange={() => toggleSelection(item.id)}
                              className="bg-white/80"
                            />
                          </div>
                          <div className="absolute top-2 right-2">
                            <Badge className={getStatusColor(item.status)}>
                              {getStatusIcon(item.status)}
                            </Badge>
                          </div>
                          {item.status === 'RUNNING' && (
                            <div className="absolute inset-0 bg-blue-500/20 rounded flex items-center justify-center">
                              <div className="bg-white/90 rounded-lg px-3 py-2 shadow-lg">
                                <div className="flex items-center space-x-2">
                                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                                  <span className="text-sm font-medium text-blue-700">Traitement...</span>
                                </div>
                              </div>
                            </div>
                          )}
                          {item.status === 'PENDING' && (
                            <Button
                              size="sm"
                              className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                processItem(item.id);
                              }}
                            >
                              <Play className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                        <p className="text-xs font-medium truncate" title={item.fileName}>
                          {item.fileName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {(item.sizeBytes / 1024).toFixed(1)}KB
                        </p>
                      </CardContent>
                    </Card>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => deleteFile(item)}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Supprimer
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Processed Section */}
      {(processedUngrouped.length > 0 || processedFolders.length > 0) && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                Traités ({processedUngrouped.length + processedFolders.reduce((acc, folder) => acc + folder.items.length, 0)})
              </h2>
              {(() => {
                const allProcessed = [...processedUngrouped, ...processedFolders.flatMap(f => f.items)];
                const totalAmount = allProcessed.reduce((sum, item) => {
                  const amount = parseFloat(item.parsedJson?.amount?.toString().replace(',', '.') || '0');
                  return sum + (isNaN(amount) ? 0 : amount);
                }, 0);
                return (
                  <div className="flex gap-4 text-sm">
                    <Badge variant="outline" className="px-3 py-1">
                      Total: {allProcessed.length} chèque{allProcessed.length > 1 ? 's' : ''}
                    </Badge>
                    <Badge variant="outline" className="px-3 py-1 bg-green-50 border-green-200">
                      Montant total: {totalAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                    </Badge>
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={async () => {
                  try {
                    const response = await fetch('/api/ocr/export-csv');
                    if (response.ok) {
                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `cheques-exports-${new Date().toISOString().split('T')[0]}.csv`;
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      document.body.removeChild(a);
                    }
                  } catch (error) {
                    console.error('Erreur lors de l\'export CSV:', error);
                  }
                }}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Exporter en CSV
              </Button>
              
              <Button 
                onClick={async () => {
                  if (!window.confirm('Êtes-vous sûr de vouloir remettre tous les chèques traités en attente de traitement ?')) {
                    return;
                  }

                  try {
                    const response = await fetch('/api/ocr/unprocess-all', {
                      method: 'POST'
                    });
                    
                    if (!response.ok) throw new Error('Unprocess failed');
                    
                    // Reload the list to reflect changes
                    await load();
                  } catch (error) {
                    console.error('Unprocess all failed:', error);
                    alert('Erreur lors de la remise en attente des chèques');
                  }
                }}
                variant="outline"
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              >
                <RotateCcw className="w-4 h-4" />
                Remettre en attente
              </Button>
              
              <Button 
                onClick={async () => {
                  if (!window.confirm('Êtes-vous sûr de vouloir supprimer tous les chèques traités ? Cette action est irréversible.')) {
                    return;
                  }

                  try {
                    const response = await fetch('/api/ocr/delete-processed', {
                      method: 'DELETE'
                    });
                    
                    if (!response.ok) throw new Error('Delete failed');
                    
                    // Reload the list to reflect changes
                    await load();
                  } catch (error) {
                    console.error('Delete all processed failed:', error);
                    alert('Erreur lors de la suppression des chèques traités');
                  }
                }}
                variant="outline"
                className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
                Supprimer tous
              </Button>
            </div>
          </div>
          
          {/* Processed Folders */}
          {processedFolders.map((folder) => (
            <div key={folder.id} className="mb-6">
              <div 
                className="flex items-center gap-2 mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded"
                onClick={() => toggleFolder(folder.id)}
              >
                {folder.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {folder.isExpanded ? <FolderOpen className="w-5 h-5 text-green-600" /> : <Folder className="w-5 h-5 text-green-600" />}
                <span className="font-medium text-gray-900">{folder.name}</span>
                <Badge variant="outline" className="text-xs">{folder.items.length} élément{folder.items.length > 1 ? 's' : ''}</Badge>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={(e) => {
                    e.stopPropagation();
                    openBulkEdit(folder);
                  }}
                >
                  <Edit3 className="w-3 h-3 mr-1" />
                  Modifier en lot
                </Button>
              </div>
              
              {folder.isExpanded && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 ml-8">
                  {folder.items.map((item) => (
                    <ContextMenu key={item.id}>
                      <ContextMenuTrigger>
                        <Card className="group hover:shadow-md transition-shadow cursor-pointer" onClick={() => openPreview(item)}>
                          <CardContent className="p-3">
                            <div className="relative">
                              <img 
                                src={item.blobUrl} 
                                alt={item.fileName}
                                className="w-full h-32 object-cover rounded mb-2"
                              />
                              <div className="absolute top-2 right-2 flex flex-col gap-1">
                                <Badge className={getStatusColor(item.status)}>
                                  {getStatusIcon(item.status)}
                                </Badge>
                                {item.status === 'COMPLETED' && item.confidence && (
                                  <Badge 
                                    className={getConfidenceColor(item.confidence)} 
                                    variant="outline"
                                    title="Score de confiance basé sur la clarté du texte et l'écriture"
                                  >
                                    {getConfidenceText(item.confidence)}
                                  </Badge>
                                )}
                              </div>
                              {/* Date and Signature Indicators */}
                              {item.status === 'COMPLETED' && item.parsedJson && (
                                <div className="absolute bottom-2 left-2 flex gap-1">
                                  {item.parsedJson.isDated && (
                                    <Badge 
                                      className="bg-green-100 text-green-700 text-xs px-1.5 py-0.5"
                                      title="Chèque daté"
                                    >
                                      <Calendar className="w-3 h-3 mr-1" />
                                      Daté
                                    </Badge>
                                  )}
                                  {item.parsedJson.isSigned && (
                                    <Badge 
                                      className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5"
                                      title="Chèque signé"
                                    >
                                      <PenTool className="w-3 h-3 mr-1" />
                                      Signé
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                            <p className="text-xs font-medium truncate" title={item.fileName}>
                              {item.fileName}
                            </p>
                            <p className="text-xs text-gray-500">
                              {(item.sizeBytes / 1024).toFixed(1)}KB
                            </p>
                            <div className="flex items-center justify-between mt-1">
                              {item.status === 'COMPLETED' && item.parsedJson?.amount && (
                                <p className="text-xs font-medium text-green-600">
                                  €{item.parsedJson.amount}
                                </p>
                              )}
                              {item.status === 'COMPLETED' && item.parsedJson && (
                                <div className="flex gap-1">
                                  {item.parsedJson.isDated && (
                                    <div className="w-2 h-2 rounded-full bg-green-500" title="Daté" />
                                  )}
                                  {item.parsedJson.isSigned && (
                                    <div className="w-2 h-2 rounded-full bg-blue-500" title="Signé" />
                                  )}
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => rerunFile(item)}>
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Relancer le traitement
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => deleteFile(item)}>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Supprimer
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              )}
            </div>
          ))}
          
          {/* Processed Ungrouped Items */}
          {processedUngrouped.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {processedUngrouped.map((item) => (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger>
                  <Card className="group hover:shadow-md transition-shadow cursor-pointer" onClick={() => openPreview(item)}>
                    <CardContent className="p-3">
                      <div className="relative">
                        <img 
                          src={item.blobUrl} 
                          alt={item.fileName}
                          className="w-full h-32 object-cover rounded mb-2"
                        />
                        <div className="absolute top-2 right-2 flex flex-col gap-1">
                          <Badge className={getStatusColor(item.status)}>
                            {getStatusIcon(item.status)}
                          </Badge>
                          {item.status === 'COMPLETED' && item.confidence && (
                            <Badge 
                              className={getConfidenceColor(item.confidence)} 
                              variant="outline"
                              title="Score de confiance basé sur la clarté du texte et l'écriture"
                            >
                              {getConfidenceText(item.confidence)}
                            </Badge>
                          )}
                        </div>
                        {/* Date and Signature Indicators */}
                        {item.status === 'COMPLETED' && item.parsedJson && (
                          <div className="absolute bottom-2 left-2 flex gap-1">
                            {item.parsedJson.isDated && (
                              <Badge 
                                className="bg-green-100 text-green-700 text-xs px-1.5 py-0.5"
                                title="Chèque daté"
                              >
                                <Calendar className="w-3 h-3 mr-1" />
                                Daté
                              </Badge>
                            )}
                            {item.parsedJson.isSigned && (
                              <Badge 
                                className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5"
                                title="Chèque signé"
                              >
                                <PenTool className="w-3 h-3 mr-1" />
                                Signé
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="text-xs font-medium truncate" title={item.fileName}>
                        {item.fileName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {(item.sizeBytes / 1024).toFixed(1)}KB
                      </p>
                      <div className="flex items-center justify-between mt-1">
                        {item.status === 'COMPLETED' && item.parsedJson?.amount && (
                          <p className="text-xs font-medium text-green-600">
                            €{item.parsedJson.amount}
                          </p>
                        )}
                        {item.status === 'COMPLETED' && item.parsedJson && (
                          <div className="flex gap-1">
                            {item.parsedJson.isDated && (
                              <div className="w-2 h-2 rounded-full bg-green-500" title="Daté" />
                            )}
                            {item.parsedJson.isSigned && (
                              <div className="w-2 h-2 rounded-full bg-blue-500" title="Signé" />
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => rerunFile(item)}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Relancer le traitement
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => deleteFile(item)}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Supprimer
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="text-center py-8">
          <Clock className="w-8 h-8 animate-spin mx-auto mb-2" />
          Chargement...
        </div>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewItem} onOpenChange={() => setPreviewItem(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {previewItem?.fileName}
            </DialogTitle>
          </DialogHeader>
          
          {previewItem && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <img 
                  src={previewItem.blobUrl} 
                  alt={previewItem.fileName}
                  className="w-full rounded-lg border"
                />
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className={getStatusColor(previewItem.status)}>
                      {getStatusIcon(previewItem.status)}
                      {previewItem.status}
                    </Badge>
                    {previewItem.status === 'COMPLETED' && previewItem.confidence && (
                      <Badge 
                        className={getConfidenceColor(previewItem.confidence)} 
                        variant="outline"
                        title="Score de confiance basé sur l'analyse de la clarté du texte, de l'écriture manuscrite et de la certitude d'extraction"
                      >
                        Fiabilité: {getConfidenceText(previewItem.confidence)}
                      </Badge>
                    )}
                    {/* Date and Signature Status Indicators */}
                    {previewItem.status === 'COMPLETED' && previewItem.parsedJson && (
                      <div className="flex gap-2">
                        {previewItem.parsedJson.isDated && (
                          <Badge 
                            className="bg-green-100 text-green-700"
                            title="Chèque daté"
                          >
                            <Calendar className="w-4 h-4 mr-1" />
                            Daté
                          </Badge>
                        )}
                        {previewItem.parsedJson.isSigned && (
                          <Badge 
                            className="bg-blue-100 text-blue-700"
                            title="Chèque signé"
                          >
                            <PenTool className="w-4 h-4 mr-1" />
                            Signé
                          </Badge>
                        )}
                      </div>
                    )}
                    <span className="text-sm text-gray-500">
                      {(previewItem.sizeBytes / 1024).toFixed(1)}KB
                    </span>
                  </div>
                  {previewItem.error && (
                    <p className="text-sm text-red-600">{previewItem.error}</p>
                  )}
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="checkNumber">Numéro de chèque</Label>
                    <Input
                      id="checkNumber"
                      value={editedFields.checkNumber || ''}
                      onChange={(e) => setEditedFields(prev => ({ ...prev, checkNumber: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="checkNumberMICR">Numéro de chèque (code)</Label>
                    <Input
                      id="checkNumberMICR"
                      value={editedFields.checkNumberMICR || ''}
                      onChange={(e) => setEditedFields(prev => ({ ...prev, checkNumberMICR: e.target.value }))}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="amount">Montant</Label>
                    <Input
                      id="amount"
                      value={editedFields.amount || ''}
                      onChange={(e) => setEditedFields(prev => ({ ...prev, amount: e.target.value }))}
                    />
                  </div>
                  <div>
                    {/* Empty column for alignment */}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="date">Date</Label>
                    <Input
                      id="date"
                      value={editedFields.date || ''}
                      onChange={(e) => setEditedFields(prev => ({ ...prev, date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="location">Lieu</Label>
                    <Input
                      id="location"
                      value={editedFields.location || ''}
                      onChange={(e) => setEditedFields(prev => ({ ...prev, location: e.target.value }))}
                    />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="emetteur">Émetteur</Label>
                  <Input
                    id="emetteur"
                    value={editedFields.emetteur || ''}
                    onChange={(e) => setEditedFields(prev => ({ ...prev, emetteur: e.target.value }))}
                  />
                </div>
                
                <div>
                  <Label htmlFor="payTo">Bénéficiaire</Label>
                  <Input
                    id="payTo"
                    value={editedFields.payTo || ''}
                    onChange={(e) => setEditedFields(prev => ({ ...prev, payTo: e.target.value }))}
                  />
                </div>
                
                <div>
                  <Label htmlFor="bank">Banque</Label>
                  <Input
                    id="bank"
                    value={editedFields.bank || ''}
                    onChange={(e) => setEditedFields(prev => ({ ...prev, bank: e.target.value }))}
                  />
                </div>
                
                <div>
                  <Label htmlFor="accountNumber">Numéro de compte</Label>
                  <Input
                    id="accountNumber"
                    value={editedFields.accountNumber || ''}
                    onChange={(e) => setEditedFields(prev => ({ ...prev, accountNumber: e.target.value }))}
                  />
                </div>
                
                <div>
                  <Label htmlFor="memo">Mémo</Label>
                  <Textarea
                    id="memo"
                    value={editedFields.memo || ''}
                    onChange={(e) => setEditedFields(prev => ({ ...prev, memo: e.target.value }))}
                    rows={2}
                  />
                </div>
                
                <div>
                  <Label htmlFor="rawText">Texte brut</Label>
                  <Textarea
                    id="rawText"
                    value={editedFields.rawText || ''}
                    onChange={(e) => setEditedFields(prev => ({ ...prev, rawText: e.target.value }))}
                    rows={4}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="isDated"
                      checked={editedFields.isDated || false}
                      onCheckedChange={(checked) => setEditedFields(prev => ({ ...prev, isDated: checked as boolean }))}
                    />
                    <Label htmlFor="isDated" className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Chèque daté
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="isSigned"
                      checked={editedFields.isSigned || false}
                      onCheckedChange={(checked) => setEditedFields(prev => ({ ...prev, isSigned: checked as boolean }))}
                    />
                    <Label htmlFor="isSigned" className="flex items-center gap-2">
                      <PenTool className="w-4 h-4" />
                      Chèque signé
                    </Label>
                  </div>
                </div>
                
                <div className="flex gap-2 pt-4">
                  <Button onClick={saveFields} className="flex-1">
                    Enregistrer les modifications
                  </Button>
                  <Button variant="outline" onClick={() => setPreviewItem(null)}>
                    Annuler
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload Preview Modal */}
      <Dialog open={showUploadPreview} onOpenChange={setShowUploadPreview}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Aperçu des fichiers à importer ({uploadPreviews.length})
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Vérifiez les fichiers avant de les importer pour traitement.
            </p>
            
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {uploadPreviews.map((preview, index) => {
                const isZip = preview.file.type === 'application/zip' || 
                             preview.file.name.toLowerCase().endsWith('.zip');
                
                return (
                  <Card key={index} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-3">
                      {isZip ? (
                        <div className="w-full h-32 flex items-center justify-center bg-gray-100 rounded mb-2">
                          <div className="text-center">
                            <Upload className="w-8 h-8 mx-auto mb-2 text-blue-600" />
                            <p className="text-xs text-gray-600">ZIP Archive</p>
                          </div>
                        </div>
                      ) : (
                        <img 
                          src={preview.previewUrl} 
                          alt={preview.file.name}
                          className="w-full h-32 object-cover rounded mb-2"
                        />
                      )}
                      <p className="text-xs font-medium truncate" title={preview.file.name}>
                        {preview.file.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {(preview.file.size / 1024).toFixed(1)}KB
                        {isZip && <span className="text-blue-600 ml-1">• Archive</span>}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            
            <div className="flex gap-2 pt-4">
              <Button onClick={confirmUpload} className="flex-1">
                <Upload className="w-4 h-4 mr-2" />
                Confirmer et importer
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  // Cleanup preview URLs
                  uploadPreviews.forEach(preview => {
                    URL.revokeObjectURL(preview.previewUrl);
                  });
                  setUploadPreviews([]);
                  setShowUploadPreview(false);
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit Modal */}
      <Dialog open={!!bulkEditFolder} onOpenChange={() => setBulkEditFolder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Modifier en lot : {bulkEditFolder?.name}
            </DialogTitle>
          </DialogHeader>
          
          {bulkEditFolder && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Ces modifications seront appliquées à tous les {bulkEditFolder.items.length} éléments du groupe.
                Laissez vide les champs que vous ne voulez pas modifier.
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="bulk-date">Date</Label>
                  <Input
                    id="bulk-date"
                    value={bulkEditFolder.bulkEditData?.date || ''}
                    onChange={(e) => setBulkEditFolder(prev => prev ? ({
                      ...prev,
                      bulkEditData: { ...prev.bulkEditData, date: e.target.value }
                    }) : null)}
                    placeholder="JJ/MM/AAAA"
                  />
                </div>
                <div>
                  <Label htmlFor="bulk-location">Lieu</Label>
                  <Input
                    id="bulk-location"
                    value={bulkEditFolder.bulkEditData?.location || ''}
                    onChange={(e) => setBulkEditFolder(prev => prev ? ({
                      ...prev,
                      bulkEditData: { ...prev.bulkEditData, location: e.target.value }
                    }) : null)}
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="bulk-emetteur">Émetteur</Label>
                <Input
                  id="bulk-emetteur"
                  value={bulkEditFolder.bulkEditData?.emetteur || ''}
                  onChange={(e) => setBulkEditFolder(prev => prev ? ({
                    ...prev,
                    bulkEditData: { ...prev.bulkEditData, emetteur: e.target.value }
                  }) : null)}
                />
              </div>
              
              <div>
                <Label htmlFor="bulk-payTo">Bénéficiaire</Label>
                <Input
                  id="bulk-payTo"
                  value={bulkEditFolder.bulkEditData?.payTo || ''}
                  onChange={(e) => setBulkEditFolder(prev => prev ? ({
                    ...prev,
                    bulkEditData: { ...prev.bulkEditData, payTo: e.target.value }
                  }) : null)}
                />
              </div>
              
              <div>
                <Label htmlFor="bulk-bank">Banque</Label>
                <Input
                  id="bulk-bank"
                  value={bulkEditFolder.bulkEditData?.bank || ''}
                  onChange={(e) => setBulkEditFolder(prev => prev ? ({
                    ...prev,
                    bulkEditData: { ...prev.bulkEditData, bank: e.target.value }
                  }) : null)}
                />
              </div>
              
              <div>
                <Label htmlFor="bulk-accountNumber">Numéro de compte</Label>
                <Input
                  id="bulk-accountNumber"
                  value={bulkEditFolder.bulkEditData?.accountNumber || ''}
                  onChange={(e) => setBulkEditFolder(prev => prev ? ({
                    ...prev,
                    bulkEditData: { ...prev.bulkEditData, accountNumber: e.target.value }
                  }) : null)}
                />
              </div>
              
              <div className="flex gap-2 pt-4">
                <Button onClick={saveBulkEdit} className="flex-1">
                  <Edit3 className="w-4 h-4 mr-2" />
                  Appliquer les modifications
                </Button>
                <Button variant="outline" onClick={() => setBulkEditFolder(null)}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
