'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface CampaignWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CSVData {
  filename: string;
  rows: number;
  columns: string[];
  data: string[][];
}

const CampaignWizard: React.FC<CampaignWizardProps> = ({ isOpen, onClose }) => {
  const router = useRouter();

  // PiP Size - Fixed at 230px
  const pipSize = 230;

  // Wizard Step Management
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;

  // Campaign name
  const [campaignName, setCampaignName] = useState('');
  const [campaignNameError, setCampaignNameError] = useState(false);

  // Validation errors from API
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // File Upload State
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [uploadedVideoURL, setUploadedVideoURL] = useState<string | null>(null);
  const [facecamDurationSec, setFacecamDurationSec] = useState(0);
  const [isExtractingDuration, setIsExtractingDuration] = useState(false);
  const [uploadedCSV, setUploadedCSV] = useState<File | null>(null);
  const [csvData, setCSVData] = useState<CSVData>({
    filename: '',
    rows: 0,
    columns: [],
    data: []
  });

  // Target rows state
  const [targetRows, setTargetRows] = useState([
    { id: 0, entryType: 'manual', urlValue: '', duration: 30 }
  ]);
  const [nextRowId, setNextRowId] = useState(1);

  // Status message state
  const [statusMessage, setStatusMessage] = useState({ type: '', message: '', icon: '' });
  const statusMessageTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Refs
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const campaignNameInputRef = useRef<HTMLInputElement>(null);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus campaign name input when opened
  useEffect(() => {
    if (isOpen && campaignNameInputRef.current) {
      setTimeout(() => {
        campaignNameInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Calculate total duration
  const calculateTotalDuration = () => {
    let total = 0;
    targetRows.forEach(row => {
      const url = row.urlValue.trim();

      // Skip empty URLs only (count both manual AND CSV)
      if (!url) return;

      total += parseInt(String(row.duration)) || 0;
    });

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    let display = '';
    if (hours > 0) {
      display += `${hours}h `;
      if (minutes > 0) display += `${minutes}m `;
      if (seconds > 0) display += `${seconds}s`;
    } else if (minutes > 0) {
      display += `${minutes}m `;
      if (seconds > 0) display += `${seconds}s`;
    } else {
      display = `${seconds}s`;
    }

    return display.trim() || '0s';
  };

  // Calculate remaining duration
  const calculateRemaining = () => {
    let scenesTotal = 0;
    targetRows.forEach(row => {
      const url = row.urlValue.trim();

      // Skip empty URLs only (count both manual AND CSV)
      if (!url) return;

      scenesTotal += parseInt(String(row.duration)) || 0;
    });
    const remaining = facecamDurationSec - scenesTotal;
    console.log(`[Remaining Debug] Facecam: ${facecamDurationSec}s, Scenes: ${scenesTotal}s, Remaining: ${remaining}s`);
    return remaining;
  };

  // Update status message
  const updateStatusMessage = (type: string, message: string, icon: string = '', autoHide: boolean = false) => {
    // Clear auto-hide timeout
    if (statusMessageTimeoutRef.current) {
      clearTimeout(statusMessageTimeoutRef.current);
      statusMessageTimeoutRef.current = null;
    }

    setStatusMessage({ type, message, icon });

    // Auto-hide for action feedback
    if (autoHide) {
      statusMessageTimeoutRef.current = setTimeout(() => {
        setStatusMessage({ type: '', message: '', icon: '' });
      }, 3000);
    }
  };

  // Update duration header
  const updateDurationHeader = () => {
    const remaining = calculateRemaining();

    if (facecamDurationSec > 0) {
      // Update status message based on remaining
      if (remaining === 0) {
        updateStatusMessage('success', 'Durations match perfectly! Ready to render.', 'check_circle');
      } else if (remaining > 0) {
        updateStatusMessage('warning', `Add ${remaining}s more to scenes (click Auto-fill or adjust durations)`, 'warning');
      } else {
        updateStatusMessage('error', `Remove ${Math.abs(remaining)}s from scenes to match facecam`, 'error');
      }
    } else {
      updateStatusMessage('info', 'Upload a facecam to see duration matching', 'info');
    }
  };

  // Update next button state
  const isNextButtonDisabled = () => {
    if (currentStep === 2 && facecamDurationSec > 0) {
      const remaining = calculateRemaining();
      return remaining !== 0;
    }
    return false;
  };

  // Update auto-fill button state
  const isAutoFillButtonDisabled = () => {
    const remaining = calculateRemaining();
    return !(facecamDurationSec > 0 && remaining > 0 && targetRows.length > 0);
  };

  // Effect to update duration header when dependencies change
  useEffect(() => {
    if (currentStep === 2) {
      updateDurationHeader();
    }
  }, [targetRows, facecamDurationSec, currentStep]);

  // Helper function to generate CSV column options
  const getCSVColumnOptions = () => {
    if (csvData.columns && csvData.columns.length > 0) {
      return csvData.columns;
    } else {
      // Fallback options if no CSV uploaded yet
      return ['website_url', 'company_website', 'url', 'website'];
    }
  };

  // Handle close
  const handleClose = () => {
    setCampaignName('');
    setCampaignNameError(false);
    setCurrentStep(1);
    onClose();
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  // Handle campaign name change
  const handleCampaignNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCampaignName(e.target.value);
    if (campaignNameError) {
      setCampaignNameError(false);
    }
  };

  // Handle next step
  const handleNextStep = () => {
    console.log('[Next Button] Clicked, currentStep:', currentStep, 'disabled:', isNextButtonDisabled());

    // CRITICAL: Stop if button is disabled
    if (isNextButtonDisabled()) {
      console.log('[Next Button] BLOCKED - button is disabled');
      return;
    }

    // Validate campaign name on step 1
    if (currentStep === 1) {
      const name = campaignName.trim();
      if (!name) {
        setCampaignNameError(true);
        return;
      }
    }

    // Validate duration matching on step 2
    if (currentStep === 2 && facecamDurationSec > 0) {
      const remaining = calculateRemaining();
      console.log('[Next Button] Step 2 validation - remaining:', remaining);
      if (remaining !== 0) {
        console.log('[Next Button] BLOCKED - duration mismatch');
        return;
      }
    }

    console.log('[Next Button] Validation passed, proceeding to next step');
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  // Handle previous step
  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const extractVideoDuration = (file: File) =>
    new Promise<number>((resolve, reject) => {
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata';
      videoElement.onloadedmetadata = () => {
        window.URL.revokeObjectURL(videoElement.src);
        resolve(Math.floor(videoElement.duration));
      };
      videoElement.onerror = () => {
        window.URL.revokeObjectURL(videoElement.src);
        reject(new Error('Failed to extract video duration'));
      };
      videoElement.src = URL.createObjectURL(file);
      videoElement.load();
    });

  const syncDurationsToFacecam = (targetDuration: number) => {
    setTargetRows((prevRows) => {
      const filled = prevRows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.urlValue.trim());

      if (filled.length === 0) {
        return prevRows;
      }

      const sanitizedTarget = Math.max(1, Math.floor(targetDuration));
      const originalTotal = filled.reduce((sum, { row }) => {
        const value = parseInt(String(row.duration)) || 0;
        return sum + Math.max(1, value);
      }, 0);

      const updated = [...prevRows];

      if (originalTotal === 0) {
        const base = Math.max(1, Math.floor(sanitizedTarget / filled.length));
        let remainder = sanitizedTarget - base * filled.length;
        filled.forEach(({ index }, idx) => {
          const extra = idx === filled.length - 1 ? remainder : 0;
          updated[index] = {
            ...updated[index],
            duration: Math.max(1, base + extra),
          };
        });
        return updated;
      }

      const ratio = sanitizedTarget / originalTotal;
      let accumulated = 0;

      filled.forEach(({ row, index }) => {
        const current = Math.max(1, parseInt(String(row.duration)) || 30);
        const scaled = Math.max(1, Math.round(current * ratio));
        updated[index] = { ...row, duration: scaled };
        accumulated += updated[index].duration;
      });

      const diff = sanitizedTarget - accumulated;
      if (diff !== 0) {
        const lastIndex = filled[filled.length - 1].index;
        const lastRow = updated[lastIndex];
        const adjusted = Math.max(
          1,
          (parseInt(String(lastRow.duration)) || 1) + diff
        );
        updated[lastIndex] = { ...lastRow, duration: adjusted };
      }

      return updated;
    });
  };

  // Handle video upload
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let newURL: string | null = null;

    try {
      if (!file.type.startsWith('video/')) {
        alert('Please upload a valid video file (MP4)');
        return;
      }

      const maxSize = 100 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('Video file must be less than 100MB');
        return;
      }

      if (uploadedVideoURL) {
        URL.revokeObjectURL(uploadedVideoURL);
      }

      setIsExtractingDuration(true);
      setFacecamDurationSec(0);

      newURL = URL.createObjectURL(file);
      setUploadedVideo(file);
      setUploadedVideoURL(newURL);

      const duration = await extractVideoDuration(file);
      setFacecamDurationSec(duration);
      console.log(`[Duration] Facecam duration extracted: ${duration}s`);
      if (currentStep === 2) {
        setTimeout(() => updateDurationHeader(), 0);
      }
      syncDurationsToFacecam(duration);
    } catch (error: any) {
      console.error('[Duration] Failed to extract video duration', error);
      alert('Failed to extract video duration. Please try uploading the video again.');
      if (newURL) {
        URL.revokeObjectURL(newURL);
      }
      setUploadedVideo(null);
      setUploadedVideoURL('');
      setFacecamDurationSec(0);
    } finally {
      setIsExtractingDuration(false);
      if (videoFileInputRef.current) {
        videoFileInputRef.current.value = '';
      }
    }
  };

  // Handle CSV upload
  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.name.endsWith('.csv')) {
        alert('Please upload a valid CSV file');
        return;
      }

      // Validate file size (5MB max)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('CSV file must be less than 5MB');
        return;
      }

      // Parse CSV
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        alert('CSV must have at least a header row and one data row');
        return;
      }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

      // Parse data rows
      const dataRows = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        if (values.length > 0 && values[0]) {
          dataRows.push(values);
        }
      }

      // Store CSV data
      setUploadedCSV(file);
      setCSVData({
        filename: file.name,
        rows: dataRows.length,
        columns: headers,
        data: dataRows
      });

      console.log('CSV uploaded:', file.name, '- Rows:', dataRows.length, '- Columns:', headers);

      if (csvFileInputRef.current) {
        csvFileInputRef.current.value = '';
      }

      if (currentStep === 2) {
        setTimeout(() => updateDurationHeader(), 0);
      }

      if (facecamDurationSec > 0) {
        syncDurationsToFacecam(facecamDurationSec);
      }
    }
  };

  // Handle add website
  const handleAddWebsite = () => {
    if (targetRows.length < 5) {
      setTargetRows([...targetRows, { id: nextRowId, entryType: 'manual', urlValue: '', duration: 30 }]);
      setNextRowId(nextRowId + 1);
    }
  };

  // Handle remove target row
  const handleRemoveRow = (id: number) => {
    if (targetRows.length > 1) {
      setTargetRows(targetRows.filter(row => row.id !== id));
    }
  };

  // Handle target row update
  const handleRowUpdate = (id: number, field: string, value: any) => {
    setTargetRows(targetRows.map(row => {
      if (row.id === id) {
        return { ...row, [field]: value };
      }
      return row;
    }));
  };

  // Handle duration blur (clamping)
  const handleDurationBlur = (id: number, currentVal: number) => {
    const row = targetRows.find(r => r.id === id);
    if (!row) return;

    const remaining = calculateRemaining();
    const allowedMax = remaining + currentVal;
    const min = 1;

    let newVal = currentVal;
    let statusMsg = '';

    if (currentVal < min) {
      newVal = min;
      if (newVal < 3) {
        statusMsg = 'Very short scenes may feel jumpy';
        updateStatusMessage('warning', statusMsg, 'warning', true);
      }
    } else if (currentVal > allowedMax && facecamDurationSec > 0) {
      newVal = allowedMax;
      statusMsg = `Adjusted to ${allowedMax}s to fit your facecam`;
      updateStatusMessage('info', statusMsg, 'info', true);
    }

    if (newVal !== currentVal) {
      handleRowUpdate(id, 'duration', newVal);
    }
  };

  // Handle auto-fill
  const handleAutoFill = () => {
    const remaining = calculateRemaining();
    if (remaining <= 0 || targetRows.length === 0) return;

    const lastRow = targetRows[targetRows.length - 1];

    // Validate last row has a URL
    if (!lastRow.urlValue.trim()) {
      alert('Please add a URL to the last row before using auto-fill');
      return;
    }

    const currentVal = parseInt(String(lastRow.duration)) || 0;
    const newVal = currentVal + remaining;

    handleRowUpdate(lastRow.id, 'duration', newVal);

    // Show success message
    updateStatusMessage('success', `Added ${remaining}s to last scene`, 'check_circle', true);
  };

  // Handle launch campaign - DATABASE-BACKED VERSION
  const handleLaunch = async () => {
    console.log('[handleLaunch] Creating campaign in database...');

    // Clear previous validation errors
    setValidationErrors({});

    // Validate campaign name
    const name = campaignName.trim();
    if (!name) {
      setCampaignNameError(true);
      alert('Please enter a campaign name');
      return;
    }

    // Build scenes array from targetRows
    const scenes: Array<{
      entry_type: 'manual' | 'csv';
      url: string;
      duration_sec: number;
      csv_column?: string;
    }> = [];
    let csvValidationError: string | null = null;

    targetRows.forEach((row) => {
      const url = row.urlValue.trim();
      const duration = parseInt(String(row.duration)) || 30;

      // Skip empty URLs
      if (!url) return;

      // For CSV mode, resolve URL from uploaded CSV
      if (row.entryType === 'csv') {
        if (!csvData.columns.length || !csvData.data.length) {
          csvValidationError = 'Upload a CSV file with at least one data row before using CSV scenes.';
          return;
        }

        const columnIndex = csvData.columns.indexOf(url);
        if (columnIndex === -1) {
          csvValidationError = `Column "${url}" was not found in the uploaded CSV.`;
          return;
        }

        const firstRowValue = (csvData.data[0]?.[columnIndex] || '').trim();
        if (!firstRowValue) {
          csvValidationError = `The first row in column "${url}" is empty. Add a URL to the CSV or choose a different column.`;
          return;
        }

        scenes.push({
          entry_type: 'csv',
          url: firstRowValue,
          csv_column: url,
          duration_sec: duration,
        });
        return;
      }

      scenes.push({
        entry_type: 'manual',
        url: url,
        duration_sec: duration,
      });
    });

    if (csvValidationError) {
      alert(csvValidationError);
      return;
    }

    // Validate we have at least one scene
    if (scenes.length === 0) {
      alert('Please configure at least one website target');
      setCurrentStep(2);
      return;
    }

    // Check if duration is still being extracted
    if (isExtractingDuration) {
      alert('Please wait while video duration is being extracted...');
      return;
    }

    // Client-side validation: Check if duration matching is required
    // Validate whenever a facecam video is uploaded (not just when duration > 0)
    if (uploadedVideo) {
      // Make sure duration was successfully extracted
      if (facecamDurationSec === 0) {
        alert('Failed to extract video duration. Please re-upload your facecam video.');
        setCurrentStep(1);
        return;
      }

      const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration_sec, 0);
      if (totalDuration !== facecamDurationSec) {
        const diff = facecamDurationSec - totalDuration;
        alert(
          `Duration mismatch: Scenes total ${totalDuration}s but facecam is ${facecamDurationSec}s.\n` +
          `Please ${diff > 0 ? 'add ' + diff + 's more' : 'remove ' + Math.abs(diff) + 's'} to match.`
        );
        setCurrentStep(2);
        return;
      }
    }

    // Create campaign via API
    try {
      let response: Response;
      const csvMeta = uploadedCSV
        ? {
            rowCount: csvData.rows,
            headers: csvData.columns,
            filename: uploadedCSV.name,
          }
        : null;

      const shouldUseFormData = !!uploadedVideo || !!uploadedCSV;

      if (shouldUseFormData) {
        console.log('[handleLaunch] Creating campaign with multipart payload...');
        const formData = new FormData();
        formData.append('data', JSON.stringify({ name, scenes, csv_meta: csvMeta }));

        if (uploadedVideo) {
          formData.append('facecam', uploadedVideo);
        }

        if (uploadedCSV) {
          formData.append('lead_csv', uploadedCSV);
        }

        response = await fetch('/api/campaigns', {
          method: 'POST',
          body: formData,
        });
      } else {
        console.log('[handleLaunch] Calling POST /api/campaigns with JSON:', { name, scenes, csv_meta: csvMeta });
        response = await fetch('/api/campaigns', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name, scenes, csv_meta: csvMeta }),
        });
      }

      const result = await response.json();

      if (response.ok) {
        // Success - campaign created
        console.log('[handleLaunch] Campaign created successfully:', result);
        const campaignId = result.id;

        // Close wizard
        handleClose();

        // Redirect to campaign detail page
        router.push(`/campaigns/${campaignId}`);
      } else if (response.status === 422) {
        // Validation error from Zod
        console.error('[handleLaunch] Validation error:', result);

        // Parse Zod error details
        if (result.details) {
          const errors: Record<string, string> = {};

          // Extract field errors from Zod format
          // result.details structure: { name: { _errors: ['...'] }, scenes: { _errors: ['...'] }, ... }
          Object.keys(result.details).forEach((field) => {
            const fieldErrors = result.details[field]._errors;
            if (fieldErrors && fieldErrors.length > 0) {
              errors[field] = fieldErrors[0];
            }
          });

          setValidationErrors(errors);

          // Show alert with errors
          const errorMessages = Object.entries(errors)
            .map(([field, message]) => `${field}: ${message}`)
            .join('\n');

          alert(`Validation failed:\n\n${errorMessages}`);
        } else {
          alert(`Validation error: ${result.error}`);
        }

        // Go back to relevant step
        setCurrentStep(2);
      } else {
        // Other error
        console.error('[handleLaunch] Error creating campaign:', result);
        alert(`Failed to create campaign: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('[handleLaunch] Exception:', error);
      alert(`Error creating campaign: ${error.message}`);
    }
  };

  // Calculate confirmation page data
  const getConfirmationData = () => {
    const mockScenesCount = targetRows.length || 1;
    const currentCredits = 1000;
    const csvEntries = csvData.rows || 0;
    const csvFilename = csvData.filename || 'No CSV uploaded';

    const totalVideos = csvEntries * mockScenesCount;

    let totalDurationSeconds = 0;
    targetRows.forEach(row => {
      totalDurationSeconds += parseInt(String(row.duration)) || 30;
    });

    const totalSeconds = csvEntries * totalDurationSeconds;
    const creditsUsed = Math.floor(totalSeconds / 60);
    const creditsRemaining = currentCredits - creditsUsed;

    return {
      csvFilename,
      csvEntries,
      totalVideos,
      currentCredits,
      creditsUsed,
      creditsRemaining
    };
  };

  if (!isOpen) return null;

  const confirmData = getConfirmationData();
  const remaining = calculateRemaining();
  const totalDuration = calculateTotalDuration();

  return (
    <div
      className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={handleBackdropClick}
    >
      <div className="bg-background-light dark:bg-foreground-dark rounded-2xl shadow-2xl ring-1 ring-black/5 w-full max-w-7xl h-[76vh] flex overflow-hidden animate-scaleIn">

        {/* Vertical Sidebar */}
        <div className="w-64 bg-gradient-to-b from-gray-50 to-gray-100/50 dark:from-gray-800/50 dark:to-gray-800/30 border-r border-border-light dark:border-border-dark py-10 px-8 flex flex-col justify-between shadow-[inset_-1px_0_4px_rgba(0,0,0,0.05)]">
          <div>
            <h2 className="text-xs font-bold text-subtext-light dark:text-subtext-dark uppercase tracking-widest mb-12 letterspacing-wide">Progress</h2>

            {/* Step 1 */}
            <div
              className="flex items-start mb-12 transition-all duration-300 cursor-pointer hover:scale-105"
              onClick={() => setCurrentStep(1)}
            >
              <div className={`flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full font-bold text-base ${
                currentStep === 1
                  ? 'bg-gradient-to-br from-primary to-blue-600 text-white shadow-lg shadow-primary/30 ring-2 ring-primary/20 ring-offset-2 ring-offset-background-light dark:ring-offset-foreground-dark'
                  : currentStep > 1
                  ? 'bg-green-500 dark:bg-green-600 text-white shadow-md'
                  : 'border-2 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 bg-background-light dark:bg-foreground-dark'
              }`}>
                1
              </div>
              <div className="ml-4 mt-1">
                <h3 className={`text-base font-bold leading-tight ${
                  currentStep === 1
                    ? 'text-primary'
                    : currentStep > 1
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-subtext-light dark:text-subtext-dark'
                }`}>Assets & List</h3>
                <p className="text-sm text-subtext-light dark:text-subtext-dark mt-1.5 leading-snug opacity-75">Upload files</p>
              </div>
            </div>

            <div className="ml-6 -mt-10 mb-4 w-1 h-10 bg-gradient-to-b from-gray-300 to-gray-200 dark:from-gray-600 dark:to-gray-700 rounded-full"></div>

            {/* Step 2 */}
            <div
              className="flex items-start mb-12 transition-all duration-300 cursor-pointer hover:scale-105"
              onClick={() => setCurrentStep(2)}
            >
              <div className={`flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full font-bold text-base ${
                currentStep === 2
                  ? 'bg-gradient-to-br from-primary to-blue-600 text-white shadow-lg shadow-primary/30 ring-2 ring-primary/20 ring-offset-2 ring-offset-background-light dark:ring-offset-foreground-dark'
                  : currentStep > 2
                  ? 'bg-green-500 dark:bg-green-600 text-white shadow-md'
                  : 'border-2 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 bg-background-light dark:bg-foreground-dark'
              }`}>
                2
              </div>
              <div className="ml-4 mt-1">
                <h3 className={`text-base font-semibold leading-tight ${
                  currentStep === 2
                    ? 'text-primary font-bold'
                    : currentStep > 2
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-subtext-light dark:text-subtext-dark'
                }`}>Targets</h3>
                <p className="text-sm text-subtext-light dark:text-subtext-dark mt-1.5 leading-snug opacity-75">Select audience</p>
              </div>
            </div>

            <div className="ml-6 -mt-10 mb-4 w-1 h-10 bg-gradient-to-b from-gray-300 to-gray-200 dark:from-gray-600 dark:to-gray-700 rounded-full"></div>

            {/* Step 3 */}
            <div
              className="flex items-start transition-all duration-300 cursor-pointer hover:scale-105"
              onClick={() => setCurrentStep(3)}
            >
              <div className={`flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full font-bold text-base ${
                currentStep === 3
                  ? 'bg-gradient-to-br from-primary to-blue-600 text-white shadow-lg shadow-primary/30 ring-2 ring-primary/20 ring-offset-2 ring-offset-background-light dark:ring-offset-foreground-dark'
                  : 'border-2 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 bg-background-light dark:bg-foreground-dark'
              }`}>
                3
              </div>
              <div className="ml-4 mt-1">
                <h3 className={`text-base font-semibold leading-tight ${
                  currentStep === 3
                    ? 'text-primary font-bold'
                    : 'text-subtext-light dark:text-subtext-dark'
                }`}>Confirm</h3>
                <p className="text-sm text-subtext-light dark:text-subtext-dark mt-1.5 leading-snug opacity-75">Review & launch</p>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-8 border-t border-border-light/50 dark:border-border-dark/50">
            <p className="text-xs text-subtext-light dark:text-subtext-dark opacity-75 hover:opacity-100 transition-opacity duration-200">
              Need help? <span className="text-primary font-medium cursor-pointer hover:underline">Contact support</span>
            </p>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col bg-gradient-to-br from-background-light to-gray-50/30 dark:from-foreground-dark dark:to-gray-800/20">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border-light/70 dark:border-border-dark/70 bg-background-light/50 dark:bg-foreground-dark/50 backdrop-blur-sm">
            <input
              ref={campaignNameInputRef}
              type="text"
              value={campaignName}
              onChange={handleCampaignNameChange}
              placeholder={campaignNameError ? 'Campaign Name is required *' : 'Campaign Name *'}
              className={`text-2xl font-bold text-text-light dark:text-text-dark tracking-tight bg-transparent border-none focus:outline-none focus:ring-0 placeholder-subtext-light dark:placeholder-subtext-dark flex-1 ${
                campaignNameError ? 'ring-2 ring-red-500' : ''
              }`}
            />
            <button
              onClick={handleClose}
              type="button"
              className="text-subtext-light dark:text-subtext-dark hover:text-text-light dark:hover:text-text-dark hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg p-2 transition-all duration-300 hover:rotate-90 active:scale-95"
            >
              <span className="material-icons">close</span>
            </button>
          </div>

          {/* Content */}
          <div className="p-10 flex-grow overflow-y-auto">

            {/* Step 1: Assets & List */}
            {currentStep === 1 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl">

                {/* Webcam Video Upload */}
                <div className="bg-background-light dark:bg-foreground-dark border border-border-light/60 dark:border-border-dark/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all duration-300 ring-1 ring-black/5 animate-slideInLeft">
                  <h3 className="font-bold text-lg text-text-light dark:text-text-dark mb-1 leading-tight tracking-tight">
                    Webcam Video <span className="text-red-500 font-semibold">*</span>
                  </h3>
                  <p className="text-sm text-subtext-light dark:text-subtext-dark mb-4 leading-relaxed">This video will be overlaid on the screen recording.</p>

                  <div
                    onClick={() => videoFileInputRef.current?.click()}
                    className="relative flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl py-12 px-8 text-center bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800/40 dark:to-gray-800/20 hover:from-blue-50 hover:to-indigo-50/50 dark:hover:from-blue-900/10 dark:hover:to-indigo-900/10 hover:border-primary hover:shadow-lg hover:shadow-primary/10 hover:scale-[1.03] transition-all duration-300 cursor-pointer group min-h-[240px] overflow-hidden"
                  >
                    <input
                      ref={videoFileInputRef}
                      type="file"
                      accept="video/mp4,video/quicktime"
                      className="hidden"
                      onChange={handleVideoUpload}
                    />

                    {!uploadedVideo ? (
                      <div>
                        <span className="material-icons text-6xl text-gray-400 group-hover:text-primary mb-3 transition-all duration-300 group-hover:scale-110 group-hover:-rotate-6">cloud_upload</span>
                        <p className="font-semibold text-text-light dark:text-text-dark text-base">
                          <span className="text-primary font-bold">Click to upload</span>{' '}
                          <span className="text-subtext-light dark:text-subtext-dark">or drag and drop</span>
                        </p>
                        <p className="text-xs text-subtext-light dark:text-subtext-dark mt-2 font-medium opacity-75">MP4, max 100MB</p>
                      </div>
                    ) : (
                      <div>
                        <span className="material-icons text-5xl text-green-500 mb-3">check_circle</span>
                        <p className="text-sm font-semibold text-text-light dark:text-text-dark">{uploadedVideo.name}</p>
                        <p className="text-xs text-subtext-light dark:text-subtext-dark mt-1">
                          {(uploadedVideo.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                        <button type="button" className="mt-3 text-xs text-primary hover:text-blue-600 font-semibold">Change video</button>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl pointer-events-none"></div>
                  </div>

                  <p className="text-xs text-red-500 mt-3 font-medium">* Required</p>
                </div>

                {/* CSV Upload */}
                <div className="bg-background-light dark:bg-foreground-dark border border-border-light/60 dark:border-border-dark/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all duration-300 ring-1 ring-black/5 animate-slideInRight">
                  <h3 className="font-bold text-lg text-text-light dark:text-text-dark mb-1 leading-tight tracking-tight">Website URLs (CSV)</h3>
                  <p className="text-sm text-subtext-light dark:text-subtext-dark mb-4 leading-relaxed">Upload a CSV with one column of website URLs.</p>

                  <div
                    onClick={() => csvFileInputRef.current?.click()}
                    className="relative flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl py-12 px-8 text-center bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800/40 dark:to-gray-800/20 hover:from-blue-50 hover:to-indigo-50/50 dark:hover:from-blue-900/10 dark:hover:to-indigo-900/10 hover:border-primary hover:shadow-lg hover:shadow-primary/10 hover:scale-[1.03] transition-all duration-300 cursor-pointer group min-h-[240px] overflow-hidden"
                  >
                    <input
                      ref={csvFileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={handleCSVUpload}
                    />

                    {!uploadedCSV ? (
                      <div>
                        <span className="material-icons text-6xl text-gray-400 group-hover:text-primary mb-3 transition-all duration-300 group-hover:scale-110 group-hover:-rotate-6">cloud_upload</span>
                        <p className="font-semibold text-text-light dark:text-text-dark text-base">
                          <span className="text-primary font-bold">Click to upload</span>{' '}
                          <span className="text-subtext-light dark:text-subtext-dark">or drag and drop</span>
                        </p>
                        <p className="text-xs text-subtext-light dark:text-subtext-dark mt-2 font-medium opacity-75">CSV, max 5MB</p>
                      </div>
                    ) : (
                      <div>
                        <span className="material-icons text-5xl text-green-500 mb-3">check_circle</span>
                        <p className="text-sm font-semibold text-text-light dark:text-text-dark">{uploadedCSV.name}</p>
                        <p className="text-xs text-subtext-light dark:text-subtext-dark mt-1">
                          {csvData.rows.toLocaleString()} rows • {csvData.columns.length} columns
                        </p>
                        <button type="button" className="mt-3 text-xs text-primary hover:text-blue-600 font-semibold">Change CSV</button>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl pointer-events-none"></div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Targets */}
            {currentStep === 2 && (
              <div className="max-w-5xl">
                <h2 className="text-2xl font-bold text-text-light dark:text-text-dark mb-2 tracking-tight">Target Websites</h2>
                <p className="text-subtext-light dark:text-subtext-dark mb-2">Configure the websites you want to record and set the duration for each.</p>
                <div className="flex items-center gap-2 mb-4 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <span className="material-icons text-blue-600 dark:text-blue-400 text-lg">info</span>
                  <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">Maximum campaign duration: 5 minutes (300 seconds)</span>
                </div>

                {/* Duration Overview Header */}
                <div className="duration-overview bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800/50 dark:to-gray-700/30 border border-border-light/60 dark:border-border-dark/60 rounded-xl p-5 mb-6 shadow-sm">

                  {/* Row 1: Duration Stats */}
                  <div className="flex items-center gap-8 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="material-icons text-primary text-xl">videocam</span>
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Facecam:</span>
                      <span className="text-lg font-bold text-gray-900 dark:text-white">
                        {isExtractingDuration ? 'Loading...' : facecamDurationSec > 0 ? `${facecamDurationSec}s` : '--s'}
                      </span>
                    </div>
                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                    <div className="flex items-center gap-2">
                      <span className="material-icons text-gray-600 dark:text-gray-300 text-xl">schedule</span>
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Remaining:</span>
                      <span className={`remaining-pill text-base font-bold px-3 py-1.5 rounded-lg ${
                        remaining === 0 ? 'green' :
                        remaining > 0 ? 'amber' :
                        remaining < 0 ? 'red' : 'neutral'
                      }`}>
                        {facecamDurationSec > 0 ? `${remaining}s` : '--s'}
                      </span>
                      <div className="relative group">
                        <span className="material-icons text-gray-400 dark:text-gray-500 text-sm cursor-help">info_outline</span>
                        <div className="tooltip-text absolute left-0 top-6 w-48 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-lg">
                          Time left to allocate. Must be 0s to render.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Auto-fill Button */}
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={handleAutoFill}
                      disabled={isAutoFillButtonDisabled()}
                      type="button"
                      className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all duration-300 hover:scale-105 disabled:hover:scale-100 shadow-md disabled:shadow-none"
                    >
                      <span className="material-icons text-base">auto_awesome</span>
                      Auto-fill Last Scene
                    </button>
                    <div className="relative group">
                      <span className="material-icons text-gray-400 dark:text-gray-500 text-sm cursor-help">help_outline</span>
                      <div className="tooltip-text absolute left-0 top-6 w-64 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-lg">
                        Automatically fills the last scene with all remaining seconds to match your facecam duration
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Status Message Area */}
                  <div className={`min-h-10 flex items-center px-3 py-2 rounded-lg transition-all duration-300 ${
                    statusMessage.type ? `status-${statusMessage.type}` : 'status-neutral'
                  }`}>
                    {statusMessage.icon && (
                      <span className="material-icons text-lg mr-2">{statusMessage.icon}</span>
                    )}
                    <span className="text-sm font-medium">{statusMessage.message}</span>
                  </div>
                </div>

                {/* Website Targets Container */}
                <div className="space-y-4 mb-6">
                  {targetRows.map((row) => (
                    <div key={row.id} className="website-target-row flex items-center gap-4 px-1">
                      <select
                        value={row.entryType}
                        onChange={(e) => handleRowUpdate(row.id, 'entryType', e.target.value)}
                        className="entry-type-select flex-none w-48 px-4 py-3 bg-foreground-light dark:bg-foreground-dark border border-border-light dark:border-border-dark rounded-xl text-sm text-text-light dark:text-text-dark focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 shadow-sm appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 20 20%27%3e%3cpath stroke=%27%236b7280%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%271.5%27 d=%27M6 8l4 4 4-4%27/%3e%3c/svg%3e')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat pr-10"
                      >
                        <option value="manual">Manual Entry</option>
                        <option value="csv">CSV Column</option>
                      </select>

                      <div className="url-input-container flex-1">
                        {row.entryType === 'manual' ? (
                          <input
                            type="text"
                            value={row.urlValue}
                            onChange={(e) => handleRowUpdate(row.id, 'urlValue', e.target.value)}
                            placeholder="https://www.example.com"
                            className="url-input w-full px-4 py-3 bg-foreground-light dark:bg-foreground-dark border border-border-light dark:border-border-dark rounded-xl text-sm text-text-light dark:text-text-dark placeholder-subtext-light dark:placeholder-subtext-dark focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 shadow-sm"
                          />
                        ) : (
                          <select
                            value={row.urlValue}
                            onChange={(e) => handleRowUpdate(row.id, 'urlValue', e.target.value)}
                            className="url-input w-full px-4 py-3 bg-foreground-light dark:bg-foreground-dark border border-border-light dark:border-border-dark rounded-xl text-sm text-text-light dark:text-text-dark focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 shadow-sm appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 20 20%27%3e%3cpath stroke=%27%236b7280%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%271.5%27 d=%27M6 8l4 4 4-4%27/%3e%3c/svg%3e')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat pr-10"
                          >
                            <option value="">Select column...</option>
                            {getCSVColumnOptions().map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={row.duration}
                          onChange={(e) => handleRowUpdate(row.id, 'duration', parseInt(e.target.value) || 0)}
                          onBlur={(e) => handleDurationBlur(row.id, parseInt(e.target.value) || 0)}
                          min="1"
                          max="300"
                          className="duration-input w-20 px-3 py-3 bg-foreground-light dark:bg-foreground-dark border border-border-light dark:border-border-dark rounded-xl text-sm text-text-light dark:text-text-dark text-center focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 shadow-sm"
                        />
                        <span className="text-sm text-subtext-light dark:text-subtext-dark font-medium">sec</span>
                        <div className="relative group">
                          <span className="material-icons text-gray-400 dark:text-gray-500 text-sm cursor-help">info_outline</span>
                          <div className="tooltip-text absolute left-0 top-6 w-56 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-lg">
                            Scene duration in seconds. Min 1s, max based on remaining time. Total campaign max: 300s (5 min).
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemoveRow(row.id)}
                        disabled={targetRows.length === 1}
                        className="remove-target-btn flex-none p-2 text-subtext-light dark:text-subtext-dark hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all duration-300 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="material-icons text-lg">close</span>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Website Button */}
                <button
                  onClick={handleAddWebsite}
                  disabled={targetRows.length >= 5}
                  className="flex items-center text-primary font-semibold text-sm hover:text-blue-600 transition-colors duration-300 group mb-8 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                >
                  <span className="material-icons mr-2 group-hover:rotate-90 transition-transform duration-300">add</span>
                  Add website
                </button>

                {/* Total Duration */}
                <div className="flex justify-end">
                  <p className="text-sm text-subtext-light dark:text-subtext-dark">
                    Total duration: <span className="font-bold text-text-light dark:text-text-dark">{totalDuration}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Confirm */}
            {currentStep === 3 && (
              <div className="max-w-6xl h-full">
                <div className="grid grid-cols-2 gap-8 h-full">
                  {/* Left: Video Preview */}
                  <div className="flex flex-col">
                    <div className="bg-foreground-light dark:bg-foreground-dark border border-border-light/60 dark:border-border-dark/60 rounded-2xl p-6 shadow-lg">
                      <h3 className="text-base font-bold text-text-light dark:text-text-dark mb-4">Webcam Video Preview</h3>
                      <div className="relative bg-black rounded-xl overflow-hidden aspect-video w-full">
                        {uploadedVideoURL ? (
                          <video className="w-full h-full object-cover" controls src={uploadedVideoURL}>
                            Your browser does not support the video tag.
                          </video>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900">
                            <span className="material-icons text-gray-600 text-6xl mb-3">videocam</span>
                            <p className="text-gray-500 text-sm">No video uploaded yet</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: CSV Info & Campaign Summary */}
                  <div className="flex flex-col space-y-6">
                    {/* Uploaded CSV Card */}
                    <div className="bg-foreground-light dark:bg-foreground-dark border border-border-light/60 dark:border-border-dark/60 rounded-2xl p-6 shadow-lg">
                      <h3 className="text-base font-bold text-text-light dark:text-text-dark mb-4">Uploaded CSV</h3>
                      <div className="flex items-center p-4 bg-background-light dark:bg-gray-800/40 rounded-xl">
                        <span className="material-icons text-primary text-3xl mr-4">description</span>
                        <div>
                          <p className="text-sm font-semibold text-text-light dark:text-text-dark mb-1">{confirmData.csvFilename}</p>
                          <p className="text-sm text-subtext-light dark:text-subtext-dark">
                            {confirmData.csvEntries > 0 ? `${confirmData.csvEntries.toLocaleString()} entries` : 'Upload CSV to see entries'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Campaign Summary Card */}
                    <div className="bg-foreground-light dark:bg-foreground-dark border border-border-light/60 dark:border-border-dark/60 rounded-2xl p-6 shadow-lg flex-1">
                      <h3 className="text-base font-bold text-text-light dark:text-text-dark mb-6">Campaign Summary</h3>
                      <div className="space-y-5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-subtext-light dark:text-subtext-dark">Videos to be generated</span>
                          <span className="text-lg font-bold text-text-light dark:text-text-dark">{confirmData.totalVideos.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between pt-4 border-t border-border-light/50 dark:border-border-dark/50">
                          <span className="text-sm text-subtext-light dark:text-subtext-dark">Current credits</span>
                          <span className="text-lg font-bold text-text-light dark:text-text-dark">{confirmData.currentCredits.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-subtext-light dark:text-subtext-dark">Credits this campaign will use</span>
                          <span className="text-lg font-bold text-text-light dark:text-text-dark">{confirmData.creditsUsed.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between pt-4 border-t border-border-light/50 dark:border-border-dark/50">
                          <span className="text-sm font-semibold text-subtext-light dark:text-subtext-dark">Credits remaining</span>
                          <span className={`text-2xl font-bold ${
                            confirmData.creditsRemaining < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-primary'
                          }`}>
                            {confirmData.creditsRemaining.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Navigation Buttons */}
          <div className="border-t border-border-light/70 dark:border-border-dark/70 p-6 bg-background-light/50 dark:bg-foreground-dark/50 flex justify-between">
            {currentStep > 1 ? (
              <button
                onClick={handlePrevStep}
                className="px-6 py-3 rounded-xl bg-gray-200 dark:bg-gray-700 text-text-light dark:text-text-dark font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-all duration-300 hover:scale-105"
              >
                Previous
              </button>
            ) : (
              <div></div>
            )}
            <div className="flex-1"></div>
            {currentStep < totalSteps ? (
              <button
                onClick={handleNextStep}
                disabled={isNextButtonDisabled()}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-blue-600 text-white font-semibold shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleLaunch}
                disabled={isExtractingDuration}
                className={`px-6 py-3 rounded-xl ${
                  isExtractingDuration
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:shadow-xl hover:shadow-green-500/40 hover:scale-105'
                } text-white font-semibold shadow-lg shadow-green-500/30 transition-all duration-300`}
              >
                {isExtractingDuration ? 'Extracting Duration...' : 'Launch Campaign'}
              </button>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes slideInLeft {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }

        .animate-scaleIn {
          animation: scaleIn 0.3s ease-out;
        }

        .animate-slideInLeft {
          animation: slideInLeft 0.4s ease-out;
        }

        .animate-slideInRight {
          animation: slideInRight 0.4s ease-out 0.1s backwards;
        }

        /* Duration Pill Colors */
        .remaining-pill.green {
          background: linear-gradient(135deg, #10b981, #059669) !important;
          color: white !important;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        }

        .remaining-pill.amber {
          background: linear-gradient(135deg, #f59e0b, #d97706) !important;
          color: white !important;
          box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
        }

        .remaining-pill.red {
          background: linear-gradient(135deg, #ef4444, #dc2626) !important;
          color: white !important;
          box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
        }

        .remaining-pill.neutral {
          background: #9ca3af !important;
          color: white !important;
          font-weight: 600;
        }

        /* Status Message Styles */
        .status-success {
          background-color: #d1fae5;
          color: #065f46;
        }
        :global(.dark) .status-success {
          background-color: #064e3b;
          color: #6ee7b7;
        }

        .status-warning {
          background-color: #fef3c7;
          color: #92400e;
        }
        :global(.dark) .status-warning {
          background-color: #78350f;
          color: #fcd34d;
        }

        .status-error {
          background-color: #fee2e2;
          color: #991b1b;
        }
        :global(.dark) .status-error {
          background-color: #7f1d1d;
          color: #fca5a5;
        }

        .status-info {
          background-color: #dbeafe;
          color: #1e40af;
        }
        :global(.dark) .status-info {
          background-color: #1e3a8a;
          color: #93c5fd;
        }

        .status-neutral {
          background-color: transparent;
          color: #6b7280;
        }

        /* Tooltip Styles */
        .tooltip-text {
          pointer-events: none;
        }

        .tooltip-text::before {
          content: '';
          position: absolute;
          top: -4px;
          left: 12px;
          width: 0;
          height: 0;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-bottom: 4px solid #111827;
        }

        /* Respect reduced motion preferences */
        @media (prefers-reduced-motion: reduce) {
          .animate-fadeIn,
          .animate-scaleIn,
          .animate-slideInLeft,
          .animate-slideInRight {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
};

export default CampaignWizard;
